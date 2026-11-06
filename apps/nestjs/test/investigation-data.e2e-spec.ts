import type { TelemetryReading } from '@fleet/contracts';
import {
  auth,
  createTestApp,
  resetDatabase,
  type TestApp,
} from './support/app.js';
import {
  DEMO_DAY,
  IDS,
  minutesAfter,
  PLACES,
  readings,
  seedReference,
} from './support/fixtures.js';

const DAY = 24 * 60;

describe('Données des outils d’enquête (/agent/trucks/*)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.app.close());
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await seedReference(t.prisma);
  });

  const insert = (
    rows: TelemetryReading[],
    source: 'history' | 'live' = 'history',
  ) =>
    t
      .http()
      .post('/api/telemetry')
      .set(auth('device'))
      .send({ readings: rows, source })
      .expect(202);

  const get = (path: string, query: Record<string, string | number> = {}) =>
    t
      .http()
      .get(`/agent/trucks/${IDS.truck}/${path}`)
      .set(auth('agent'))
      .query(query);

  const window = (fromMinute: number, toMinute: number) => ({
    from: minutesAfter(fromMinute).toISOString(),
    to: minutesAfter(toMinute).toISOString(),
  });

  // 0-60 : trajet de 80 km ; 60-120 : arrêt moteur tournant à l'atelier ; 125-135 : −100 L moteur coupé
  const handBuilt = readings([
    { minute: 0, level: 500, speed: 80, ignition: true, odometer: 1000 },
    { minute: 30, level: 488, speed: 80, ignition: true, odometer: 1040 },
    {
      minute: 60,
      level: 476,
      ignition: true,
      odometer: 1080,
      ...PLACES.workshop,
    },
    {
      minute: 90,
      level: 474.5,
      ignition: true,
      odometer: 1080,
      ...PLACES.workshop,
    },
    {
      minute: 120,
      level: 473,
      ignition: true,
      odometer: 1080,
      ...PLACES.workshop,
    },
    { minute: 125, level: 420, odometer: 1080, ...PLACES.workshop },
    { minute: 135, level: 373, odometer: 1080, ...PLACES.workshop },
  ]);

  it('compute_fuel_balance : résultat attendu sur des relevés construits à la main', async () => {
    await insert(handBuilt);
    await t
      .http()
      .post('/api/fuel-card-transactions')
      .set(auth('device'))
      .send({
        transactions: [
          {
            truckId: IDS.truck,
            occurredAt: minutesAfter(40).toISOString(),
            liters: 20,
          },
        ],
        source: 'history',
      })
      .expect(200);

    const response = await get('fuel-balance', window(0, 135)).expect(200);
    // attendu = 80 × 30/100 + 1 h × 3 = 27 ; inexpliqué = 127 + 20 − 27
    expect(response.body).toEqual({
      distanceKm: 80,
      movingConsumptionL: 24,
      idleConsumptionL: 3,
      expectedConsumptionL: 27,
      refueledL: 20,
      observedLevelChangeL: 127,
      unexplainedLossL: 120,
    });
  });

  it('get_tank_curve : chute principale, remontées, échantillons', async () => {
    await insert([
      ...handBuilt,
      // Remontée de 90 L sans plein : artefact
      ...readings([
        { minute: 145, level: 463, odometer: 1080, ...PLACES.workshop },
      ]),
    ]);
    const response = await get('tank-curve', window(0, 150)).expect(200);
    expect(response.body).toMatchObject({
      startLevelL: 500,
      endLevelL: 463,
      minLevelL: 373,
      maxLevelL: 500,
      biggestDrop: {
        from: minutesAfter(120).toISOString(),
        to: minutesAfter(135).toISOString(),
        liters: 100,
        durationMin: 15,
        ignitionOff: false,
        maxSpeedKmh: 0,
      },
      recoveries: [{ at: minutesAfter(145).toISOString(), liters: 90 }],
    });
    expect(response.body.samples).toHaveLength(8);
  });

  it('get_vehicle_activity : distance, minutes en mouvement, arrêts rattachés aux lieux', async () => {
    await insert(handBuilt);
    const response = await get('activity', window(0, 135)).expect(200);
    expect(response.body).toEqual({
      distanceKm: 80,
      movingMinutes: 30,
      stops: [
        {
          from: minutesAfter(60).toISOString(),
          to: minutesAfter(135).toISOString(),
          durationMin: 75,
          ignitionOff: false,
          place: { name: 'Atelier PL Valence', type: 'workshop' },
          lat: PLACES.workshop.lat,
          lon: PLACES.workshop.lon,
        },
      ],
    });
  });

  it('find_fuel_transactions : pleins de la période avec le lieu', async () => {
    await t
      .http()
      .post('/api/fuel-card-transactions')
      .set(auth('device'))
      .send({
        transactions: [
          {
            truckId: IDS.truck,
            occurredAt: minutesAfter(30).toISOString(),
            placeId: IDS.station,
            liters: 250,
            unitPriceEur: 1.7,
            totalEur: 425,
          },
          {
            truckId: IDS.truck,
            occurredAt: minutesAfter(5 * DAY).toISOString(),
            liters: 100,
          },
        ],
        source: 'history',
      })
      .expect(200);
    const response = await get('fuel-transactions', window(0, 60)).expect(200);
    expect(response.body).toEqual({
      refuels: [
        {
          at: minutesAfter(30).toISOString(),
          place: 'AS24 Valence Sud',
          liters: 250,
          totalEur: 425,
          source: 'fuel_card',
          invoiceId: null,
        },
      ],
    });
  });

  it('find_similar_events : chutes passées, heure locale, alerte et verdict liés', async () => {
    const nightOf = (day: number) => DEMO_DAY - day * DAY * 60_000;
    // Deux chutes nocturnes (02:30 heure de Paris = 00:30 UTC) sur l'aire, les 3/10 et 9/10
    await insert([
      ...readings(
        [
          { minute: 30, level: 400 },
          { minute: 35, level: 370 },
          { minute: 40, level: 345 },
        ],
        { start: nightOf(11) },
      ),
      ...readings(
        [
          { minute: 30, level: 420 },
          { minute: 40, level: 360 },
        ],
        { start: nightOf(5) },
      ),
      ...readings([{ minute: 0, level: 500 }], { start: DEMO_DAY }),
    ]);
    const alert = await t.prisma.alert.create({
      data: {
        truckId: IDS.truck,
        type: 'fuel_drop',
        status: 'escalated',
        windowStart: new Date(nightOf(5) + 30 * 60_000),
        windowEnd: new Date(nightOf(5) + 40 * 60_000),
        detectedAt: new Date(),
        investigation: {
          create: { status: 'completed', category: 'theft_suspected' },
        },
      },
    });

    const response = await get('similar-events', { lookbackDays: 30 }).expect(
      200,
    );
    expect(response.body.events).toEqual([
      {
        at: new Date(nightOf(11) + 30 * 60_000).toISOString(),
        dropL: 55,
        hourOfDay: 2,
        placeType: 'rest_area',
        ignitionOff: true,
        alertId: null,
        verdictCategory: null,
      },
      {
        at: new Date(nightOf(5) + 30 * 60_000).toISOString(),
        dropL: 60,
        hourOfDay: 2,
        placeType: 'rest_area',
        ignitionOff: true,
        alertId: alert.id,
        verdictCategory: 'theft_suspected',
      },
    ]);
    // Fenêtre de 7 jours : seule la seconde chute reste
    const recent = await get('similar-events', { lookbackDays: 7 }).expect(200);
    expect(recent.body.events).toHaveLength(1);
  });

  it('get_truck_profile', async () => {
    const response = await t
      .http()
      .get(`/agent/trucks/${IDS.otherTruck}/profile`)
      .set(auth('agent'))
      .expect(200);
    expect(response.body).toEqual({
      plate: 'EF-456-GH',
      make: 'Volvo',
      model: 'FH',
      energy: 'hvo',
      tankCapacityL: 700,
      hasReefer: true,
      baselineLPer100km: 32,
      idleLPerHour: 3.5,
      homeDepot: 'Dépôt Avignon',
      sensorNotes: 'Sonde remplacée le 02/09, valeurs erratiques signalées',
    });
  });

  it('valide la fenêtre (72 h max, `to` après `from`) et les paramètres', async () => {
    await insert(handBuilt);
    const tooLong = await get('tank-curve', window(0, 73 * 60)).expect(400);
    expect(tooLong.body.message).toEqual(['to: fenêtre maximale 72 h']);
    await get('tank-curve', window(60, 0)).expect(400);
    await get('tank-curve', { from: 'hier', to: 'demain' }).expect(400);
    await get('similar-events', { lookbackDays: 31 }).expect(400);
    await t
      .http()
      .get(`/agent/trucks/${IDS.unknown}/profile`)
      .set(auth('agent'))
      .expect(404);
    await get('fuel-balance', window(10 * DAY, 10 * DAY + 60)).expect(404);
  });
});
