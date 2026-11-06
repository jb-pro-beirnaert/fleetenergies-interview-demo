// Model, MCP server or API momentarily unreachable: the task is failed with `retryable: true`
export class RetryableError extends Error {
  override name = 'RetryableError';
}

// 404 on the alert, task, step or verdict: the database was wiped during processing.
// The worker drops the task without calling `fail` and resumes polling (spec 06).
export class TaskAbandonedError extends Error {
  override name = 'TaskAbandonedError';
}

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
