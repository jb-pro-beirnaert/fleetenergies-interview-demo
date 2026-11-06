import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createApiClient, UNAVAILABLE_MESSAGE } from './api-client.js';
import { createMcpServer } from './mcp-server.js';

const TRUCK_ID = '3f1c2a4e-8b7d-4c6a-9e5f-1a2b3c4d5e6f';
const FROM = '2026-11-05T08:00:00Z';
const TO = '2026-11-05T20:00:00Z';

const PROFILE = {
  plate: 'AB-123-CD',
  make: 'Renault',
  model: 'T 480',
  energy: 'diesel',
  tankCapacityL: 600,
  hasReefer: true,
  baselineLPer100km: 31,
  idleLPerHour: 2.5,
  homeDepot: 'Rungis',
  sensorNotes: null,
};

const BALANCE = {
  distanceKm: 210,
  movingConsumptionL: 65.1,
  idleConsumptionL: 2.5,
  expectedConsumptionL: 67.6,
  refueledL: 0,
  observedLevelChangeL: -142,
  unexplainedLossL: 74.4,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('serveur MCP', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let client: Client;

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock = vi.fn<typeof fetch>();
    const api = createApiClient({
      baseUrl: 'http://api.test',
      token: 'agent-token',
      fetch: fetchMock,
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createMcpServer(api).connect(serverSide);
    client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientSide);
  });

  afterEach(async () => {
    await client.close();
    vi.restoreAllMocks();
  });

  const call = (name: string, args: Record<string, unknown>) =>
    client.callTool({ name, arguments: args }) as Promise<CallToolResult>;

  it('liste les 7 outils avec description et schéma d’entrée', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      'get_truck_profile',
      'get_tank_curve',
      'get_vehicle_activity',
      'find_fuel_transactions',
      'read_driver_messages',
      'compute_fuel_balance',
      'find_similar_events',
    ]);
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema.required).toContain('truckId');
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }
    const curve = tools.find((t) => t.name === 'get_tank_curve');
    expect(curve?.inputSchema.required).toEqual(['truckId', 'from', 'to']);
  });

  it('appelle la route API et renvoie son contenu (texte et structuré)', async () => {
    fetchMock.mockResolvedValueOnce(json(200, PROFILE));

    const result = await call('get_truck_profile', { truckId: TRUCK_ID });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(PROFILE);
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(PROFILE) }]);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`http://api.test/agent/trucks/${TRUCK_ID}/profile`);
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer agent-token');
  });

  it('transmet la fenêtre et lookbackDays en query', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, BALANCE))
      .mockResolvedValueOnce(json(200, { events: [] }));

    await call('compute_fuel_balance', { truckId: TRUCK_ID, from: FROM, to: TO });
    await call('find_similar_events', { truckId: TRUCK_ID, lookbackDays: 14 });

    const balanceUrl = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(balanceUrl.pathname).toBe(`/agent/trucks/${TRUCK_ID}/fuel-balance`);
    expect(balanceUrl.searchParams.get('from')).toBe(FROM);
    expect(balanceUrl.searchParams.get('to')).toBe(TO);

    const similarUrl = new URL(String(fetchMock.mock.calls[1]![0]));
    expect(similarUrl.pathname).toBe(`/agent/trucks/${TRUCK_ID}/similar-events`);
    expect(similarUrl.searchParams.get('lookbackDays')).toBe('14');
  });

  it('arguments invalides → résultat en erreur, sans appel API', async () => {
    const result = await call('get_tank_curve', {
      truckId: TRUCK_ID,
      from: FROM,
      to: '2026-11-09T20:00:00Z',
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('fenêtre maximale 72 h');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('4xx de l’API → résultat en erreur avec le message de l’API', async () => {
    fetchMock.mockResolvedValueOnce(
      json(404, { statusCode: 404, message: 'Camion introuvable', error: 'Not Found' }),
    );

    const result = await call('get_truck_profile', { truckId: TRUCK_ID });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: 'Camion introuvable' }]);
  });

  it('5xx ou timeout → « service indisponible »', async () => {
    fetchMock
      .mockResolvedValueOnce(json(503, { message: 'down' }))
      .mockRejectedValueOnce(new DOMException('timeout', 'TimeoutError'));

    for (let i = 0; i < 2; i++) {
      const result = await call('read_driver_messages', {
        truckId: TRUCK_ID,
        from: FROM,
        to: TO,
      });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([{ type: 'text', text: UNAVAILABLE_MESSAGE }]);
    }
  });

  it('journalise une ligne par appel, sans le contenu', async () => {
    fetchMock.mockResolvedValueOnce(json(200, PROFILE));

    await call('get_truck_profile', { truckId: TRUCK_ID });

    const lines = vi.mocked(console.error).mock.calls.map(([line]) => String(line));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      msg: 'tool_call',
      tool: 'get_truck_profile',
      status: 'ok',
      apiStatus: 200,
    });
    expect(lines[0]).not.toContain('AB-123-CD');
  });
});
