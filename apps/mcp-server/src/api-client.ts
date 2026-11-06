export const API_TIMEOUT_MS = 10_000;
export const UNAVAILABLE_MESSAGE = 'service indisponible, réessaie plus tard';

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

// Message d'erreur NestJS : `message` est une chaîne ou une liste de chaînes
function errorMessage(body: unknown, status: number): string {
  const message = (body as { message?: unknown } | null)?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.join(' ; ');
  return `erreur ${status}`;
}

// Client des routes `/agent/*` : 4xx → message de l'API, 5xx ou timeout → indisponible
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
