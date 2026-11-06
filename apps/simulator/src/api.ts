// Client HTTP minimal de l'API (le simulateur ne touche jamais la base).

export interface ApiConfig {
  apiUrl: string;
  deviceToken: string;
  adminToken: string;
}

/** Variables de la spec 08 ; défauts pour un lancement depuis l'hôte. */
export const configFromEnv = (env: NodeJS.ProcessEnv = process.env): ApiConfig => ({
  apiUrl: (env.API_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  deviceToken: env.DEVICE_TOKEN ?? 'dev-device-token',
  adminToken: env.ADMIN_TOKEN ?? 'dev-admin-token',
});

export class ApiClient {
  readonly config: ApiConfig;

  constructor(config: ApiConfig) {
    this.config = config;
  }

  async post<T>(path: string, role: 'device' | 'admin', body?: unknown): Promise<T> {
    const token = role === 'device' ? this.config.deviceToken : this.config.adminToken;
    const url = `${this.config.apiUrl}${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new Error(
        `API injoignable (${url}) : ${(error as Error).message}. L'API tourne-t-elle (« npm run dev:up ») ? API_URL=${this.config.apiUrl}`,
      );
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`POST ${path} → ${response.status} ${response.statusText} : ${text.slice(0, 500)}`);
    }
    return (await response.json()) as T;
  }
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
