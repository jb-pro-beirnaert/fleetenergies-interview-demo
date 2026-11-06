import { TasksService } from '../src/tasks/tasks.service.js';
import {
  auth,
  createTestApp,
  resetDatabase,
  type TestApp,
} from './support/app.js';
import { createAlertWithTask, seedReference } from './support/fixtures.js';

describe('File de tâches', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.app.close());
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await seedReference(t.prisma);
  });

  const claim = (workerId: string) =>
    t
      .http()
      .post('/agent/tasks/claim')
      .set(auth('agent'))
      .send({ type: 'investigate_alert', workerId });

  const expireLock = (taskId: string) =>
    t.prisma.task.update({
      where: { id: taskId },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });

  it('réserve une tâche : alerte en `investigating`, enquête `running`', async () => {
    const { alert, task } = await createAlertWithTask(t.prisma);
    const response = await claim('worker-a').expect(200);
    expect(response.body).toEqual({
      id: task.id,
      type: 'investigate_alert',
      payload: { alertId: alert.id },
      attempts: 1,
    });

    const stored = await t.prisma.task.findUniqueOrThrow({
      where: { id: task.id },
    });
    expect(stored).toMatchObject({
      status: 'in_progress',
      lockedBy: 'worker-a',
      attempts: 1,
    });
    expect(stored.lockedUntil!.getTime()).toBeGreaterThan(
      Date.now() + 4 * 60_000,
    );
    expect(
      await t.prisma.alert.findUnique({ where: { id: alert.id } }),
    ).toMatchObject({
      status: 'investigating',
    });
    expect(
      await t.prisma.investigation.findUnique({ where: { alertId: alert.id } }),
    ).toMatchObject({
      status: 'running',
    });
  });

  it('204 quand il n’y a rien à faire', async () => {
    await claim('worker-a').expect(204);
  });

  it('deux réservations simultanées obtiennent deux tâches différentes', async () => {
    await createAlertWithTask(t.prisma);
    await createAlertWithTask(t.prisma);
    const [a, b] = await Promise.all([claim('worker-a'), claim('worker-b')]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.id).not.toBe(b.body.id);
  });

  it('une tâche dont `available_at` est dans le futur n’est pas réservable', async () => {
    await createAlertWithTask(t.prisma, {
      availableAt: new Date(Date.now() + 60_000),
    });
    await claim('worker-a').expect(204);
  });

  it('verrou expiré : re-réservable ; après 3 tentatives, `failed` et alerte `escalated`', async () => {
    const { alert, task } = await createAlertWithTask(t.prisma);

    for (const attempt of [1, 2, 3]) {
      const response = await claim(`worker-${attempt}`).expect(200);
      expect(response.body).toMatchObject({ id: task.id, attempts: attempt });
      await expireLock(task.id);
    }
    // Tentatives épuisées : plus réservable, en attente du balayage
    await claim('worker-4').expect(204);

    expect(await t.app.get(TasksService).sweep()).toBe(1);
    expect(
      await t.prisma.task.findUnique({ where: { id: task.id } }),
    ).toMatchObject({
      status: 'failed',
      lockedBy: null,
    });
    const escalated = await t.prisma.alert.findUniqueOrThrow({
      where: { id: alert.id },
    });
    expect(escalated).toMatchObject({
      status: 'escalated',
      decision: 'escalated',
    });
    expect(escalated.details).toMatchObject({
      failure: { attempts: 3, error: expect.stringContaining('Verrou expiré') },
    });
    expect(
      await t.prisma.investigation.findUnique({ where: { alertId: alert.id } }),
    ).toMatchObject({
      status: 'failed',
    });
  });

  it('le balayage ignore les verrous encore valides et les tâches qui ont des tentatives', async () => {
    const { task } = await createAlertWithTask(t.prisma);
    await claim('worker-a').expect(200);
    expect(await t.app.get(TasksService).sweep()).toBe(0);
    await expireLock(task.id);
    expect(await t.app.get(TasksService).sweep()).toBe(0);
  });

  it('complete : seul le titulaire du verrou peut terminer', async () => {
    const { task } = await createAlertWithTask(t.prisma);
    await claim('worker-a').expect(200);
    await t
      .http()
      .post(`/agent/tasks/${task.id}/complete`)
      .set(auth('agent'))
      .send({ workerId: 'worker-b' })
      .expect(409);
    await t
      .http()
      .post(`/agent/tasks/${task.id}/complete`)
      .set(auth('agent'))
      .send({ workerId: 'worker-a' })
      .expect(204);
    expect(
      await t.prisma.task.findUnique({ where: { id: task.id } }),
    ).toMatchObject({
      status: 'done',
    });
  });

  it('fail relançable : retour en `pending` avec délai croissant', async () => {
    const { alert, task } = await createAlertWithTask(t.prisma);
    await claim('worker-a').expect(200);
    const before = Date.now();
    await t
      .http()
      .post(`/agent/tasks/${task.id}/fail`)
      .set(auth('agent'))
      .send({
        workerId: 'worker-a',
        error: 'Ollama injoignable',
        retryable: true,
      })
      .expect(204);

    const stored = await t.prisma.task.findUniqueOrThrow({
      where: { id: task.id },
    });
    expect(stored).toMatchObject({
      status: 'pending',
      lockedBy: null,
      lastError: 'Ollama injoignable',
    });
    expect(stored.availableAt.getTime()).toBeGreaterThanOrEqual(before + 9_000);
    await claim('worker-b').expect(204);
    expect(
      await t.prisma.alert.findUnique({ where: { id: alert.id } }),
    ).toMatchObject({
      status: 'investigating',
    });
  });

  it('fail non relançable : échec définitif, enquête `failed`, alerte `escalated`', async () => {
    const { alert, task } = await createAlertWithTask(t.prisma);
    await claim('worker-a').expect(200);
    await t
      .http()
      .post(`/agent/tasks/${task.id}/fail`)
      .set(auth('agent'))
      .send({
        workerId: 'worker-a',
        error: 'Verdict impossible à obtenir',
        retryable: false,
      })
      .expect(204);

    expect(
      await t.prisma.task.findUnique({ where: { id: task.id } }),
    ).toMatchObject({
      status: 'failed',
    });
    const escalated = await t.prisma.alert.findUniqueOrThrow({
      where: { id: alert.id },
    });
    expect(escalated.status).toBe('escalated');
    expect(escalated.details).toMatchObject({
      levelBeforeL: 520,
      failure: { error: 'Verdict impossible à obtenir' },
    });
  });

  it('404 pour une tâche inconnue, 409 pour un autre worker', async () => {
    const { task } = await createAlertWithTask(t.prisma);
    await t
      .http()
      .post('/agent/tasks/00000000-0000-4000-8000-000000000999/fail')
      .set(auth('agent'))
      .send({ workerId: 'w', error: 'x', retryable: true })
      .expect(404);
    await claim('worker-a').expect(200);
    await t
      .http()
      .post(`/agent/tasks/${task.id}/fail`)
      .set(auth('agent'))
      .send({ workerId: 'intrus', error: 'x', retryable: true })
      .expect(409);
  });
});
