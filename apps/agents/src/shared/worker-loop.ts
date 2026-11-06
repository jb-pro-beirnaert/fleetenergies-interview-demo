import type { ClaimedTask, TaskType } from '@fleet/contracts';
import type { ApiClient } from './api-client.js';
import { errorMessage, RetryableError, TaskAbandonedError } from './errors.js';
import { log } from './logger.js';

// Below the 5 min lock held by the API on a claimed task
export const TASK_TIMEOUT_MS = 4 * 60_000;
export const MAX_BACKOFF_MS = 30_000;

export type TaskHandler = (task: ClaimedTask, signal: AbortSignal) => Promise<void>;

export type WorkerOptions = {
  api: ApiClient;
  type: TaskType;
  workerId: string;
  pollIntervalMs: number;
  handle: TaskHandler;
  // Aborted on SIGTERM: stop claiming, fail the current task as retryable, return
  stop: AbortSignal;
  taskTimeoutMs?: number;
  maxBackoffMs?: number;
};

// Resolves early when `signal` is aborted
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });

// Rejects as soon as `signal` is aborted, without waiting for `promise`
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  promise.catch(() => {});
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

// Generic worker loop (spec 06): one task at a time, polling, growing wait when the API is down
export async function runWorker(options: WorkerOptions): Promise<void> {
  const { api, type, workerId, pollIntervalMs, stop } = options;
  const maxBackoffMs = options.maxBackoffMs ?? MAX_BACKOFF_MS;
  let backoffMs = pollIntervalMs;

  while (!stop.aborted) {
    let task: ClaimedTask | null;
    try {
      task = await api.claim(type, workerId);
      backoffMs = pollIntervalMs;
    } catch (error) {
      log({ msg: 'claim_failed', error: errorMessage(error), retryInMs: backoffMs });
      await sleep(backoffMs, stop);
      backoffMs = Math.min(backoffMs * 2, maxBackoffMs);
      continue;
    }

    if (task) await processTask(task, options);
    else await sleep(pollIntervalMs, stop);
  }
}

async function processTask(task: ClaimedTask, options: WorkerOptions): Promise<void> {
  const { api, workerId, handle, stop } = options;
  const timeout = AbortSignal.timeout(options.taskTimeoutMs ?? TASK_TIMEOUT_MS);
  const signal = AbortSignal.any([stop, timeout]);
  const started = performance.now();
  const context = { taskId: task.id, type: task.type, attempt: task.attempts };
  log({ msg: 'task_claimed', ...context });

  try {
    await abortable(handle(task, signal), signal);
    await api.complete(task.id, workerId);
    log({ msg: 'task_completed', ...context, durationMs: Math.round(performance.now() - started) });
  } catch (error) {
    if (error instanceof TaskAbandonedError) {
      log({ msg: 'task_abandoned', ...context, reason: error.message });
      return;
    }
    const reason = stop.aborted
      ? 'worker shutting down'
      : timeout.aborted
        ? `task timeout (${(options.taskTimeoutMs ?? TASK_TIMEOUT_MS) / 1000} s)`
        : errorMessage(error);
    const retryable = error instanceof RetryableError || signal.aborted;
    log({ msg: 'task_failed', ...context, retryable, error: reason });
    try {
      await api.fail(task.id, { workerId, error: reason.slice(0, 4000), retryable });
    } catch (failError) {
      log({ msg: 'fail_report_failed', ...context, error: errorMessage(failError) });
    }
  }
}
