import {
  auth,
  createTestApp,
  resetDatabase,
  type TestApp,
} from './support/app.js';
import { DRIVERS, IDS, readings, seedReference } from './support/fixtures.js';

// 60 L drop while stopped in 12 min
const DROP = readings([
  { minute: 0, level: 400 },
  { minute: 4, level: 380 },
  { minute: 8, level: 360 },
  { minute: 12, level: 340 },
]);

describe('Ingestion and detector', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.app.close());
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await seedReference(t.prisma);
  });

  const postTelemetry = (body: object) =>
    t.http().post('/api/telemetry').set(auth('device')).send(body);

  it('a `history` batch creates no alert', async () => {
    const response = await postTelemetry({
      readings: DROP,
      source: 'history',
    }).expect(202);
    expect(response.body).toEqual({ inserted: 4, alertsCreated: 0 });
    expect(await t.prisma.alert.count()).toBe(0);
    expect(await t.prisma.task.count()).toBe(0);
  });

  it('a `live` batch with a 60 L drop while stopped in 12 min creates an alert and a task', async () => {
    const response = await postTelemetry({
      readings: DROP,
      source: 'live',
    }).expect(202);
    expect(response.body).toEqual({ inserted: 4, alertsCreated: 1 });

    const [alert] = await t.prisma.alert.findMany();
    expect(alert).toMatchObject({
      truckId: IDS.truck,
      type: 'fuel_drop',
      status: 'detected',
    });
    expect(alert.dropL?.toNumber()).toBe(60);
    expect(alert.details).toMatchObject({
      levelBeforeL: 400,
      levelAfterL: 340,
      maxSpeedKmh: 0,
      ignitionOffShare: 1,
    });

    const tasks = await t.prisma.task.findMany();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      type: 'investigate_alert',
      status: 'pending',
      payload: { alertId: alert.id },
    });
  });

  it('replaying the same batch inserts nothing the second time', async () => {
    await postTelemetry({ readings: DROP, source: 'live' }).expect(202);
    const again = await postTelemetry({
      readings: DROP,
      source: 'live',
    }).expect(202);
    expect(again.body).toEqual({ inserted: 0, alertsCreated: 0 });
    expect(await t.prisma.telemetryReading.count()).toBe(4);
    expect(await t.prisma.alert.count()).toBe(1);
  });

  it('a drop over several successive batches creates a single alert, extended while it is `detected`', async () => {
    const steps = readings([
      { minute: 0, level: 400 },
      { minute: 5, level: 390 },
      { minute: 10, level: 355 },
      { minute: 15, level: 330 },
      { minute: 20, level: 300 },
    ]);
    await postTelemetry({ readings: steps.slice(0, 3), source: 'live' }).expect(
      202,
    );
    await postTelemetry({ readings: steps.slice(3, 4), source: 'live' }).expect(
      202,
    );
    const last = await postTelemetry({
      readings: steps.slice(4),
      source: 'live',
    }).expect(202);
    expect(last.body.alertsCreated).toBe(0);

    const alerts = await t.prisma.alert.findMany();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].windowEnd.toISOString()).toBe(steps[4].recordedAt);
    expect(alerts[0].dropL?.toNumber()).toBe(100);
    expect(alerts[0].details).toMatchObject({
      levelBeforeL: 400,
      levelAfterL: 300,
    });
    expect(await t.prisma.task.count()).toBe(1);
  });

  it('an alert already under investigation is neither extended nor duplicated', async () => {
    const steps = readings([
      { minute: 0, level: 400 },
      { minute: 10, level: 350 },
      { minute: 15, level: 320 },
    ]);
    await postTelemetry({ readings: steps.slice(0, 2), source: 'live' }).expect(
      202,
    );
    await t.prisma.alert.updateMany({ data: { status: 'investigating' } });
    await postTelemetry({ readings: steps.slice(2), source: 'live' }).expect(
      202,
    );

    const alerts = await t.prisma.alert.findMany();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].dropL?.toNumber()).toBe(50);
  });

  it('a decrease while driving triggers nothing', async () => {
    const driving = readings([
      { minute: 0, level: 400, speed: 80 },
      { minute: 5, level: 370, speed: 82 },
      { minute: 10, level: 350, speed: 80 },
    ]);
    const response = await postTelemetry({
      readings: driving,
      source: 'live',
    }).expect(202);
    expect(response.body.alertsCreated).toBe(0);
  });

  it('rejects an invalid body (400) and an unknown truck (400)', async () => {
    await postTelemetry({ readings: [], source: 'live' }).expect(400);
    await postTelemetry({ readings: DROP, source: 'demo' }).expect(400);
    const unknown = readings([{ minute: 0, level: 400 }], {
      truckId: IDS.unknown,
    });
    const response = await postTelemetry({
      readings: unknown,
      source: 'live',
    }).expect(400);
    expect(response.body.message).toBe('Unknown reference');
  });

  it('fuel cards and messages: idempotent', async () => {
    const transactions = {
      transactions: [
        {
          truckId: IDS.truck,
          occurredAt: '2026-10-14T09:15:00Z',
          placeId: IDS.station,
          liters: 250,
          unitPriceEur: 1.7,
          totalEur: 425,
        },
      ],
      source: 'live',
    };
    const messages = {
      messages: [
        {
          driverId: DRIVERS[0].id,
          truckId: IDS.truck,
          sentAt: '2026-10-14T09:20:00Z',
          body: 'Arrived safely at the customer',
        },
      ],
      source: 'live',
    };
    for (const expected of [1, 0]) {
      const cards = await t
        .http()
        .post('/api/fuel-card-transactions')
        .set(auth('device'))
        .send(transactions)
        .expect(200);
      expect(cards.body).toEqual({ inserted: expected });
      const sent = await t
        .http()
        .post('/api/driver-messages')
        .set(auth('device'))
        .send(messages)
        .expect(200);
      expect(sent.body).toEqual({ inserted: expected });
    }
  });
});
