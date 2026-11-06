export const API_TIMEOUT_MS = 10_000;
export const UNAVAILABLE_MESSAGE = 'service unavailable, try again later';

export type ApiResult =
  | { ok: true; status: number; data: Record<string, unknown> }
  | { ok: false; status: number | null; message: string };

export type ApiClient = {
  get(path: string, query?: Record<string, string | number>): Promise<ApiResult>;
};

type Options = {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

// NestJS error message: `message` is a string or a list of strings
function errorMessage(body: unknown, status: number): string {
  const message = (body as { message?: unknown } | null)?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.join(' ; ');
  return `error ${status}`;
}

// Client of the `/agent/*` routes: 4xx → API message, 5xx or timeout → unavailable
export function createApiClient({
  baseUrl,
  token,
  timeoutMs = API_TIMEOUT_MS,
  fetch: fetchFn = fetch,
}: Options): ApiClient {
  return {
    async get(path, query = {}) {
      const url = new URL(path, baseUrl);
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, String(value));
      }

      let response: Response;
      let body: unknown;
      try {
        response = await fetchFn(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
        body = await response.json().catch(() => null);
      } catch {
        return { ok: false, status: null, message: UNAVAILABLE_MESSAGE };
      }

      if (response.status >= 500) {
        return { ok: false, status: response.status, message: UNAVAILABLE_MESSAGE };
      }
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          message: errorMessage(body, response.status),
        };
      }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        return { ok: false, status: response.status, message: UNAVAILABLE_MESSAGE };
      }
      return { ok: true, status: response.status, data: body as Record<string, unknown> };
    },
  };
}
