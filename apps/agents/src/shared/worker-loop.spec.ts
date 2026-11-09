import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClaimedTask } from '@fleet/contracts';
import type { ApiClient } from './api-client.js';
import { RetryableError, TaskAbandonedError } from './errors.js';
import { runWorker, type TaskHandler } from './worker-loop.js';

const TASK: ClaimedTask = {
  id: '6a1d1b7e-0c4f-4b8e-9d2a-3e5f7a9b1c2d',
  type: 'investigate_alert',
  payload: { alertId: '0b9f7c1e-2d3a-4e5f-8a6b-7c8d9e0f1a2b' },
  attempts: 1,
};

describe('worker loop', () => {
  let stop: AbortController;
  let api: { [K in keyof ApiClient]: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    stop = new AbortController();
    // One task, then stop the worker on the next claim
    api = {
      claim: vi.fn().mockResolvedValueOnce(TASK).mockImplementation(async () => {
        stop.abort();
        return null;
      }),
      complete: vi.fn(async () => {}),
      fail: vi.fn(async () => {}),
      getAlertContext: vi.fn(),
      addStep: vi.fn(),
      submitVerdict: vi.fn(),
      getInvoiceText: vi.fn(),
      submitExtraction: vi.fn(),
    };
  });
  afterEach(() => vi.restoreAllMocks());

  const run = (handle: TaskHandler, taskTimeoutMs?: number) =>
    runWorker({
      api: api as unknown as ApiClient,
      type: 'investigate_alert',
      workerId: 'w1',
      pollIntervalMs: 1,
      handle,
      stop: stop.signal,
      taskTimeoutMs,
    });

  it('completes a task handled successfully', async () => {
    await run(async () => {});
    expect(api.complete).toHaveBeenCalledWith(TASK.id, 'w1');
    expect(api.fail).not.toHaveBeenCalled();
  });

  it('fails as retryable on a transient error', async () => {
    await run(async () => {
      throw new RetryableError('model unreachable');
    });
    expect(api.fail).toHaveBeenCalledWith(TASK.id, { workerId: 'w1', error: 'model unreachable', retryable: true });
  });

  it('fails as non-retryable on any other error', async () => {
    await run(async () => {
      throw new Error('no verdict');
    });
    expect(api.fail).toHaveBeenCalledWith(TASK.id, expect.objectContaining({ retryable: false }));
  });

  it('drops the task without fail on a 404 (database wiped)', async () => {
    await run(async () => {
      throw new TaskAbandonedError('alert not found');
    });
    expect(api.fail).not.toHaveBeenCalled();
    expect(api.complete).not.toHaveBeenCalled();
  });

  it('fails as retryable when the task times out', async () => {
    await run(() => new Promise(() => {}), 10);
    expect(api.fail).toHaveBeenCalledWith(TASK.id, expect.objectContaining({ retryable: true, error: expect.stringContaining('timeout') }));
  });

  it('on shutdown, fails the current task as retryable and stops claiming', async () => {
    await run(() => {
      stop.abort();
      return new Promise(() => {});
    });
    expect(api.fail).toHaveBeenCalledWith(TASK.id, { workerId: 'w1', error: 'worker shutting down', retryable: true });
    expect(api.claim).toHaveBeenCalledTimes(1);
  });

  it('keeps polling when the API is down', async () => {
    api.claim = vi
      .fn()
      .mockRejectedValueOnce(new RetryableError('API unreachable'))
      .mockImplementation(async () => {
        stop.abort();
        return null;
      });
    await run(async () => {});
    expect(api.claim).toHaveBeenCalledTimes(2);
  });
});
