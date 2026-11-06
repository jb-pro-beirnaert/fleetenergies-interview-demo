import {
  AlertContext,
  ClaimedTask,
  VerdictOutcome,
  type FailRequest,
  type StepInput,
  type TaskType,
  type VerdictSubmission,
} from '@fleet/contracts';
import { RetryableError, TaskAbandonedError } from './errors.js';

export const API_TIMEOUT_MS = 10_000;

export type VerdictResult =
  | { ok: true; outcome: VerdictOutcome }
  | { ok: false; unknownToolCallIds: string[] };

// Driving calls from the worker to the API (claim, steps, verdict, complete/fail)
export type ApiClient = {
  claim(type: TaskType, workerId: string): Promise<ClaimedTask | null>;
  complete(taskId: string, workerId: string): Promise<void>;
  fail(taskId: string, request: FailRequest): Promise<void>;
  getAlertContext(alertId: string): Promise<AlertContext>;
  addStep(alertId: string, step: StepInput): Promise<void>;
  submitVerdict(alertId: string, submission: VerdictSubmission): Promise<VerdictResult>;
};

type Options = {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

// NestJS error body: `message` is a string or a list of strings
function describe(body: unknown, status: number): string {
  const message = (body as { message?: unknown } | null)?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.join('; ');
  return `HTTP ${status}`;
}

// Network error, timeout or 5xx → RetryableError; 404 → TaskAbandonedError; other 4xx → Error
export function createApiClient({
  baseUrl,
  token,
  timeoutMs = API_TIMEOUT_MS,
  fetch: fetchFn = fetch,
}: Options): ApiClient {
  async function request(
    method: 'GET' | 'POST',
    path: string,
    payload?: unknown,
  ): Promise<{ status: number; body: unknown }> {
    let response: Response;
    let body: unknown;
    try {
      response = await fetchFn(new URL(path, baseUrl), {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
      body = await response.json().catch(() => null);
    } catch (error) {
      throw new RetryableError(`API unreachable (${method} ${path}): ${String(error)}`);
    }

    const { status } = response;
    if (status >= 500) {
      throw new RetryableError(`API unavailable (${method} ${path}): HTTP ${status}`);
    }
    if (status === 404) {
      throw new TaskAbandonedError(`${method} ${path}: ${describe(body, status)}`);
    }
    if (status === 422 && Array.isArray((body as { unknownToolCallIds?: unknown })?.unknownToolCallIds)) {
      return { status, body };
    }
    if (status >= 400) {
      throw new Error(`${method} ${path}: ${describe(body, status)}`);
    }
    return { status, body };
  }

  const tasks = '/agent/tasks';
  const investigation = (alertId: string) =>
    `/agent/investigations/${encodeURIComponent(alertId)}`;

  return {
    async claim(type, workerId) {
      const { status, body } = await request('POST', `${tasks}/claim`, { type, workerId });
      return status === 204 ? null : ClaimedTask.parse(body);
    },

    async complete(taskId, workerId) {
      await request('POST', `${tasks}/${encodeURIComponent(taskId)}/complete`, { workerId });
    },

    async fail(taskId, failRequest) {
      await request('POST', `${tasks}/${encodeURIComponent(taskId)}/fail`, failRequest);
    },

    async getAlertContext(alertId) {
      const { body } = await request('GET', `/agent/alerts/${encodeURIComponent(alertId)}`);
      return AlertContext.parse(body);
    },

    async addStep(alertId, step) {
      await request('POST', `${investigation(alertId)}/steps`, step);
    },

    async submitVerdict(alertId, submission) {
      const { status, body } = await request(
        'POST',
        `${investigation(alertId)}/verdict`,
        submission,
      );
      if (status === 422) {
        return {
          ok: false,
          unknownToolCallIds: (body as { unknownToolCallIds: string[] }).unknownToolCallIds,
        };
      }
      return { ok: true, outcome: VerdictOutcome.parse(body) };
    },
  };
}
