import {
  auth,
  createTestApp,
  resetDatabase,
  type TestApp,
} from './support/app.js';
import {
  IDS,
  minutesAfter,
  readings,
  seedReference,
} from './support/fixtures.js';
import {
  postStep,
  postVerdict,
  startInvestigation,
  verdict,
} from './support/investigation.js';

describe('Screen routes', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.app.close());
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await seedReference(t.prisma);
  });

  it('list and detail of an alert with investigation, steps and verdict', async () => {
    const { alert } = await startInvestigation(t);
    await postStep(t, alert.id, {
      attempt: 1,
      seq: 1,
      kind: 'tool_result',
      toolCallId: 'E1',
      payload: { ok: 1 },
    }).expect(200);
    await postVerdict(
      t,
      alert.id,
      verdict({ category: 'theft_suspected', confidence: 0.92 }),
    ).expect(200);

    const list = await t.http().get('/api/alerts').expect(200);
    expect(list.body).toEqual([
      expect.objectContaining({
        id: alert.id,
        status: 'escalated',
        decision: 'escalated',
        plate: 'AB-123-CD',
        carrier: 'Transports Durance',
        dropL: 180,
        category: 'theft_suspected',
        confidence: 0.92,
        toolCallsCount: 2,
      }),
    ]);
    expect(
      (await t.http().get('/api/alerts?status=closed').expect(200)).body,
    ).toEqual([]);
    await t.http().get('/api/alerts?status=nope').expect(400);

    const detail = await t.http().get(`/api/alerts/${alert.id}`).expect(200);
    expect(detail.body.truck).toMatchObject({
      plate: 'AB-123-CD',
      carrier: 'Transports Durance',
    });
    expect(detail.body.investigation).toMatchObject({
      status: 'completed',
      category: 'theft_suspected',
      verdict: { category: 'theft_suspected' },
    });
    expect(
      detail.body.investigation.steps.map((s: { seq: number }) => s.seq),
    ).toEqual([0, 1, 2]);
    expect(detail.body.review).toBeNull();
  });

  it('human review: only after the decision, only once', async () => {
    const { alert } = await startInvestigation(t);
    const review = (decision: string) =>
      t
        .http()
        .post(`/api/alerts/${alert.id}/review`)
        .send({ decision, comment: 'Vu' });

    await review('confirm').expect(409); // still under investigation
    await postVerdict(t, alert.id, verdict()).expect(200);
    const response = await review('dismiss').expect(200);
    expect(response.body).toEqual({ alertId: alert.id, status: 'dismissed' });
    await review('confirm').expect(409);
    await review('maybe').expect(400);
  });

  it('statistiques', async () => {
    const closed = await startInvestigation(t);
    await postVerdict(t, closed.alert.id, verdict()).expect(200);
    await t
      .http()
      .post(`/api/alerts/${closed.alert.id}/review`)
      .send({ decision: 'confirm' })
      .expect(200);
    await t
      .http()
      .post('/api/telemetry')
      .set(auth('device'))
      .send({
        readings: readings([
          { minute: 300, level: 500, speed: 80, ignition: true },
        ]),
        source: 'live',
      })
      .expect(202);

    const stats = await t.http().get('/api/stats').expect(200);
    expect(stats.body).toMatchObject({
      alerts: { total: 1, byStatus: { confirmed: 1 } },
      ruleOnly: { toReviewManually: 1 },
      withAgents: { autoClosed: 1, escalated: 0, pending: 0 },
      investigations: { avgToolCalls: 2, failed: 0 },
      humanAgreement: { reviewed: 1, agreed: 1 },
      model: 'fleet-qwen',
      simulatedNow: minutesAfter(300).toISOString(),
    });
  });

  it('fleet overview: window ending at the latest reading, state per truck', async () => {
    const empty = await t.http().get('/api/fleet').expect(200);
    expect(empty.body).toMatchObject({ from: null, to: null, hours: 24 });
    expect(empty.body.trucks).toHaveLength(2);
    expect(empty.body.trucks[0]).toMatchObject({
      state: 'no_data',
      last: null,
      readings: [],
    });

    await t
      .http()
      .post('/api/telemetry')
      .set(auth('device'))
      .send({
        readings: [
          ...readings([
            {
              minute: 0,
              level: 520,
              speed: 0,
              ignition: false,
              odometer: 1000,
            },
            {
              minute: 120,
              level: 500,
              speed: 80,
              ignition: true,
              odometer: 1100,
            },
            {
              minute: 180,
              level: 480,
              speed: 85,
              ignition: true,
              odometer: 1180,
            },
          ]),
          ...readings([{ minute: 60, level: 300 }], {
            truckId: IDS.otherTruck,
          }),
        ],
        source: 'history',
      })
      .expect(202);

    const fleet = await t.http().get('/api/fleet?hours=2').expect(200);
    expect(fleet.body).toMatchObject({
      from: minutesAfter(60).toISOString(),
      to: minutesAfter(180).toISOString(),
      hours: 2,
    });
    const [truck, other] = fleet.body.trucks;
    expect(truck).toMatchObject({
      plate: 'AB-123-CD',
      carrier: 'Transports Durance',
      state: 'moving',
      last: { at: minutesAfter(180).toISOString(), levelL: 480, speedKmh: 85 },
      distanceKm: 80,
      movingMinutes: 60,
    });
    expect(truck.readings).toHaveLength(2); // minute 0 is outside the window
    // reading at the window start, but 2 h before the end: no recent data
    expect(other).toMatchObject({
      state: 'no_data',
      readings: [expect.any(Object)],
    });

    await t.http().get('/api/fleet?hours=100').expect(400);
  });

  it('full curve, positions and places', async () => {
    await t
      .http()
      .post('/api/telemetry')
      .set(auth('device'))
      .send({
        readings: readings([
          { minute: 0, level: 500, speed: 80, ignition: true },
          { minute: 5, level: 498 },
        ]),
        source: 'history',
      })
      .expect(202);
    const query = {
      from: minutesAfter(0).toISOString(),
      to: minutesAfter(10).toISOString(),
    };
    const curve = await t
      .http()
      .get(`/api/trucks/${IDS.truck}/tank-curve`)
      .query(query)
      .expect(200);
    expect(curve.body).toEqual([
      {
        at: minutesAfter(0).toISOString(),
        levelL: 500,
        speedKmh: 80,
        ignition: true,
      },
      {
        at: minutesAfter(5).toISOString(),
        levelL: 498,
        speedKmh: 0,
        ignition: false,
      },
    ]);
    const positions = await t
      .http()
      .get(`/api/trucks/${IDS.truck}/positions`)
      .query(query)
      .expect(200);
    expect(positions.body).toHaveLength(2);
    const places = await t.http().get('/api/places').expect(200);
    expect(places.body).toHaveLength(4);
    await t
      .http()
      .get(`/api/trucks/${IDS.unknown}/positions`)
      .query(query)
      .expect(404);
  });

  it('health', async () => {
    expect((await t.http().get('/api/health').expect(200)).body).toEqual({
      status: 'ok',
      database: 'ok',
    });
  });
});
