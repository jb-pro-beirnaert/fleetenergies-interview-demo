// Minimal HTTP client of the API (the simulator never touches the database).

import type { HistoryLoadBatch, PlaceList } from '@fleet/contracts';
import type { Backend } from './simulation.ts';
import { sendStep } from './replay.ts';
import type { SimStore } from './store.ts';

export interface ApiConfig {
  apiUrl: string;
  deviceToken: string;
  adminToken: string;
}

/** Variables from spec 08; defaults for a run from the host. */
export const configFromEnv = (env: NodeJS.ProcessEnv = process.env): ApiConfig => ({
  apiUrl: (env.API_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  deviceToken: env.DEVICE_TOKEN ?? 'dev-device-token',
  adminToken: env.ADMIN_TOKEN ?? 'dev-admin-token',
});

/** `public`: screen routes, without a token. */
type Role = 'device' | 'admin' | 'public';

export class ApiClient {
  readonly config: ApiConfig;

  constructor(config: ApiConfig) {
    this.config = config;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path, 'public');
  }

  post<T>(path: string, role: Role, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, role, body);
  }

  /** Multipart body (V2 invoices); fetch sets the content type with its boundary. */
  postForm<T>(path: string, role: Role, form: FormData): Promise<T> {
    return this.request<T>('POST', path, role, form);
  }

  private async request<T>(method: string, path: string, role: Role, body?: unknown): Promise<T> {
    const isForm = body instanceof FormData;
    const token = role === 'device' ? this.config.deviceToken : role === 'admin' ? this.config.adminToken : null;
    const url = `${this.config.apiUrl}${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body === undefined || isForm ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      });
    } catch (error) {
      throw new Error(`API injoignable (${url}) : ${(error as Error).message}`);
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${method} ${path} → ${response.status} ${response.statusText} : ${text.slice(0, 500)}`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

/** What the simulation needs from the API (replaced by a fake in the tests). */
export function apiBackend(api: ApiClient, store: SimStore): Backend {
  return {
    wipe: () => api.post<void>('/admin/wipe', 'admin'),
    loadHistory: async (batch: HistoryLoadBatch) => {
      await api.post('/admin/history/load', 'admin', batch);
    },
    sendStep: (step) => sendStep(api, step, (file) => store.readInvoice(file)),
    hasReference: async () => (await api.get<PlaceList>('/api/places')).length > 0,
    async waitUntilReady(log) {
      for (let attempt = 0; ; attempt++) {
        try {
          await api.get('/api/health');
          return;
        } catch (error) {
          if (attempt === 0) log(`Waiting for the API (${api.config.apiUrl})… ${(error as Error).message}`);
          await new Promise((resolve) => setTimeout(resolve, 2_000));
        }
      }
    },
  };
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
