import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApiClient } from './api-client.js';
import { createHttpApp } from './http.js';
import { createMcpServer } from './mcp-server.js';

describe('transport HTTP', () => {
  let server: Server;
  let mcpUrl: URL;

  beforeAll(async () => {
    const api = createApiClient({ baseUrl: 'http://api.test', token: 'agent-token' });
    const app = createHttpApp({
      clientToken: 'mcp-token',
      createMcpServer: () => createMcpServer(api),
    });
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    mcpUrl = new URL(`http://127.0.0.1:${port}/mcp`);
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  const connect = async (token?: string) => {
    const client = new Client({ name: 'test', version: '1.0.0' });
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    await client.connect(new StreamableHTTPClientTransport(mcpUrl, { requestInit: { headers } }));
    return client;
  };

  it('accepte le bon jeton et liste les outils', async () => {
    const client = await connect('mcp-token');
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(7);
    await client.close();
  });

  it.each([
    ['sans jeton', undefined],
    ['avec un mauvais jeton', 'wrong-token'],
  ])('refuse un appel %s (401)', async (_label, token) => {
    const response = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(response.status).toBe(401);
    await expect(connect(token)).rejects.toThrow();
  });

  it('répond au healthcheck sans jeton', async () => {
    const response = await fetch(new URL('/health', mcpUrl));
    expect(response.status).toBe(200);
  });
});
