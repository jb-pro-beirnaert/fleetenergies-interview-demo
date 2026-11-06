import { TasksService } from '../src/tasks/tasks.service.js';
import {
  auth,
  createTestApp,
  resetDatabase,
  type TestApp,
} from './support/app.js';
import { createAlertWithTask, seedReference } from './support/fixtures.js';

describe('Task queue', () => {
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

  it('claims a task: alert `investigating`, investigation `running`', async () => {
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

  it('204 when there is nothing to do', async () => {
    await claim('worker-a').expect(204);
  });

  it('two simultaneous claims get two different tasks', async () => {
    await createAlertWithTask(t.prisma);
    await createAlertWithTask(t.prisma);
    const [a, b] = await Promise.all([claim('worker-a'), claim('worker-b')]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.id).not.toBe(b.body.id);
  });

  it('a task whose `available_at` is in the future cannot be claimed', async () => {
    await createAlertWithTask(t.prisma, {
      availableAt: new Date(Date.now() + 60_000),
    });
    await claim('worker-a').expect(204);
  });

  it('expired lock: claimable again; after 3 attempts, `failed` and alert `escalated`', async () => {
    const { alert, task } = await createAlertWithTask(t.prisma);

    for (const attempt of [1, 2, 3]) {
      const response = await claim(`worker-${attempt}`).expect(200);
      expect(response.body).toMatchObject({ id: task.id, attempts: attempt });
      await expireLock(task.id);
    }
    // Attempts used up: no longer claimable, waiting for the sweep
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
      failure: { attempts: 3, error: expect.stringContaining('Lock expired') },
    });
    expect(
      await t.prisma.investigation.findUnique({ where: { alertId: alert.id } }),
    ).toMatchObject({
      status: 'failed',
    });
  });

  it('the sweep ignores locks still valid and tasks with attempts left', async () => {
    const { task } = await createAlertWithTask(t.prisma);
    await claim('worker-a').expect(200);
    expect(await t.app.get(TasksService).sweep()).toBe(0);
    await expireLock(task.id);
    expect(await t.app.get(TasksService).sweep()).toBe(0);
  });

  it('complete: only the lock holder can complete', async () => {
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

  it('retryable fail: back to `pending` with an increasing delay', async () => {
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

  it('non-retryable fail: permanent failure, investigation `failed`, alert `escalated`', async () => {
    const { alert, task } = await createAlertWithTask(t.prisma);
    await claim('worker-a').expect(200);
    await t
      .http()
      .post(`/agent/tasks/${task.id}/fail`)
      .set(auth('agent'))
      .send({
        workerId: 'worker-a',
        error: 'Could not obtain a verdict',
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
      failure: { error: 'Could not obtain a verdict' },
    });
  });

  it('404 for an unknown task, 409 for another worker', async () => {
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
