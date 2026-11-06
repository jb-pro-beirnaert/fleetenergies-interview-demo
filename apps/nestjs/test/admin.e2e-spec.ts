import {
  auth,
  createTestApp,
  resetDatabase,
  type TestApp,
} from './support/app.js';
import { DRIVERS, IDS, readings, REFERENCE } from './support/fixtures.js';

describe('Administration', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.app.close());
  beforeEach(() => resetDatabase(t.prisma));

  const HISTORY = {
    ...REFERENCE,
    assignments: [
      {
        id: '00000000-0000-4000-8000-000000000401',
        truckId: IDS.truck,
        driverId: IDS.driver,
        startsAt: '2026-10-01T04:00:00Z',
        endsAt: '2026-10-01T16:00:00Z',
      },
    ],
    telemetry: readings(
      [
        { minute: 0, level: 400 },
        { minute: 10, level: 330 },
      ],
      { start: Date.parse('2026-10-03T00:30:00Z') },
    ),
    refuels: [
      { truckId: IDS.truck, occurredAt: '2026-10-02T10:00:00Z', liters: 300 },
    ],
    messages: [
      {
        driverId: DRIVERS[0].id,
        truckId: IDS.truck,
        sentAt: '2026-10-02T11:00:00Z',
        body: 'RAS',
      },
    ],
  };

  const load = (body: object) =>
    t.http().post('/admin/history/load').set(auth('admin')).send(body);

  it('charge référentiel et historique, de façon idempotente et sans détection', async () => {
    const first = await load(HISTORY).expect(200);
    expect(first.body.inserted).toEqual({
      carriers: 1,
      places: 4,
      trucks: 2,
      drivers: 2,
      assignments: 1,
      telemetry: 2,
      refuels: 1,
      messages: 1,
    });
    expect(await t.prisma.alert.count()).toBe(0);
    expect(
      await t.prisma.telemetryReading.count({ where: { source: 'history' } }),
    ).toBe(2);

    const second = await load(HISTORY).expect(200);
    expect(
      Object.values(second.body.inserted).every((count) => count === 0),
    ).toBe(true);
  });

  it('/admin/reset remet la journée de démo à zéro sans toucher à l’historique', async () => {
    await load(HISTORY).expect(200);
    await t
      .http()
      .post('/api/telemetry')
      .set(auth('device'))
      .send({
        readings: readings([
          { minute: 150, level: 520 },
          { minute: 155, level: 420 },
          { minute: 162, level: 340 },
        ]),
        source: 'live',
      })
      .expect(202);
    await t
      .http()
      .post('/api/fuel-card-transactions')
      .set(auth('device'))
      .send({
        transactions: [
          {
            truckId: IDS.truck,
            occurredAt: '2026-10-14T09:00:00Z',
            liters: 200,
          },
        ],
        source: 'live',
      })
      .expect(200);
    await t
      .http()
      .post('/api/driver-messages')
      .set(auth('device'))
      .send({
        messages: [
          {
            driverId: IDS.driver,
            truckId: IDS.truck,
            sentAt: '2026-10-14T09:05:00Z',
            body: 'Plein fait',
          },
        ],
        source: 'live',
      })
      .expect(200);
    await t
      .http()
      .post('/agent/tasks/claim')
      .set(auth('agent'))
      .send({ type: 'investigate_alert', workerId: 'w' })
      .expect(200);

    const response = await t
      .http()
      .post('/admin/reset')
      .set(auth('admin'))
      .expect(200);
    expect(response.body.deleted).toEqual({
      telemetry: 3,
      refuels: 1,
      messages: 1,
      alerts: 1,
      investigations: 1,
      steps: 0,
      reviews: 0,
      tasks: 1,
    });

    expect(await t.prisma.telemetryReading.count()).toBe(2);
    expect(await t.prisma.refuel.count()).toBe(1);
    expect(await t.prisma.driverMessage.count()).toBe(1);
    expect(await t.prisma.truck.count()).toBe(2);
    expect(await t.prisma.alert.count()).toBe(0);
    expect(await t.prisma.task.count()).toBe(0);
  });

  it('refuse un lot invalide', async () => {
    await load({
      trucks: [{ ...REFERENCE.trucks[0], plate: 'ab123cd' }],
    }).expect(400);
  });
});
