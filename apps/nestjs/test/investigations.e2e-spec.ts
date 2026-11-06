import {
  auth,
  createTestApp,
  resetDatabase,
  type TestApp,
} from './support/app.js';
import { IDS, seedReference } from './support/fixtures.js';
import {
  postStep,
  postVerdict,
  startInvestigation,
  verdict,
} from './support/investigation.js';

describe('Enquêtes : contexte, étapes, verdict et décision', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.app.close());
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await seedReference(t.prisma);
  });

  it('renvoie le contexte de l’alerte', async () => {
    const { alert } = await startInvestigation(t);
    const response = await t
      .http()
      .get(`/agent/alerts/${alert.id}`)
      .set(auth('agent'))
      .expect(200);
    expect(response.body).toEqual({
      alertId: alert.id,
      type: 'fuel_drop',
      truckId: IDS.truck,
      plate: 'AB-123-CD',
      windowStart: alert.windowStart.toISOString(),
      windowEnd: alert.windowEnd.toISOString(),
      dropL: 180,
      details: { levelBeforeL: 520, levelAfterL: 340 },
      detectedAt: alert.detectedAt.toISOString(),
    });
    await t
      .http()
      .get(`/agent/alerts/${IDS.unknown}`)
      .set(auth('agent'))
      .expect(404);
  });

  it('les étapes sont idempotentes sur (enquête, tentative, seq)', async () => {
    const { alert } = await startInvestigation(t);
    const step = {
      attempt: 1,
      seq: 1,
      kind: 'reasoning',
      payload: { text: 'Je regarde la courbe' },
    };
    expect((await postStep(t, alert.id, step).expect(200)).body).toEqual({
      created: true,
    });
    expect((await postStep(t, alert.id, step).expect(200)).body).toEqual({
      created: false,
    });
    expect(await t.prisma.investigationStep.count()).toBe(3);
    await postStep(t, alert.id, { ...step, kind: 'unknown' }).expect(400);
  });

  it('un verdict citant un `toolCallId` inexistant est refusé (422)', async () => {
    const { alert } = await startInvestigation(t);
    const response = await postVerdict(
      t,
      alert.id,
      verdict({
        evidence: [
          { toolCallId: 'E1', finding: 'ok' },
          { toolCallId: 'E7', finding: 'inventé' },
        ],
      }),
    ).expect(422);
    expect(response.body.unknownToolCallIds).toEqual(['E7']);
    expect(
      await t.prisma.investigation.findUnique({ where: { alertId: alert.id } }),
    ).toMatchObject({
      status: 'running',
    });
  });

  it('auto-clôture un `sensor_fault` confiant ; un second envoi est sans effet (200)', async () => {
    const { alert } = await startInvestigation(t);
    const first = await postVerdict(t, alert.id, verdict()).expect(200);
    expect(first.body).toEqual({
      alertId: alert.id,
      alertStatus: 'closed',
      decision: 'auto_closed',
      alreadyCompleted: false,
    });
    const stored = await t.prisma.investigation.findUniqueOrThrow({
      where: { alertId: alert.id },
    });
    expect(stored).toMatchObject({
      status: 'completed',
      category: 'sensor_fault',
      model: 'fleet-qwen',
      promptVersion: 'investigator-v1',
      toolCallsCount: 2,
    });
    expect(stored.finishedAt).not.toBeNull();

    const second = await postVerdict(
      t,
      alert.id,
      verdict({ category: 'theft_suspected', confidence: 0.99 }),
    ).expect(200);
    expect(second.body).toMatchObject({
      alertStatus: 'closed',
      alreadyCompleted: true,
    });
    expect(
      (
        await t.prisma.investigation.findUniqueOrThrow({
          where: { alertId: alert.id },
        })
      ).category,
    ).toBe('sensor_fault');
  });

  it.each([
    ['theft_suspected', 0.95, 'escalated'],
    ['inconclusive', 0.9, 'escalated'],
    ['equipment_transfer', 0.6, 'escalated'],
    ['legitimate_operation', 0.8, 'closed'],
  ] as const)('%s à %s → %s', async (category, confidence, status) => {
    const { alert } = await startInvestigation(t);
    const response = await postVerdict(
      t,
      alert.id,
      verdict({ category, confidence }),
    ).expect(200);
    expect(response.body.alertStatus).toBe(status);
    expect(
      await t.prisma.alert.findUnique({ where: { id: alert.id } }),
    ).toMatchObject({ status });
  });

  it('les preuves doivent venir de la tentative en cours', async () => {
    const { alert, task } = await startInvestigation(t);
    // Seconde tentative : E1 et E2 appartiennent à la tentative 1
    await t.prisma.task.update({
      where: { id: task.id },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });
    await t
      .http()
      .post('/agent/tasks/claim')
      .set(auth('agent'))
      .send({ type: 'investigate_alert', workerId: 'worker-b' })
      .expect(200);
    await postVerdict(t, alert.id, verdict()).expect(422);

    await postStep(t, alert.id, {
      attempt: 2,
      seq: 0,
      kind: 'tool_call',
      toolName: 'get_truck_profile',
      toolCallId: 'E1',
      payload: {},
    }).expect(200);
    await postVerdict(t, alert.id, verdict()).expect(200);
    // Les étapes de la tentative 1 sont conservées
    expect(await t.prisma.investigationStep.count()).toBe(3);
  });

  it('refuse un verdict invalide (400) et un verdict sur une enquête en échec (409)', async () => {
    const { alert, task } = await startInvestigation(t);
    await postVerdict(t, alert.id, verdict({ summary: 'trop court' })).expect(
      400,
    );
    await postVerdict(t, alert.id, verdict({ evidence: [] })).expect(400);

    await t
      .http()
      .post(`/agent/tasks/${task.id}/fail`)
      .set(auth('agent'))
      .send({ workerId: 'worker-a', error: 'boom', retryable: false })
      .expect(204);
    await postVerdict(t, alert.id, verdict()).expect(409);
  });
});
