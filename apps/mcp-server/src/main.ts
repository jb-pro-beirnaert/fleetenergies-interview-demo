import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createApiClient } from './api-client.js';
import { loadConfig } from './config.js';
import { createHttpApp } from './http.js';
import { log } from './log.js';
import { createMcpServer } from './mcp-server.js';

const config = loadConfig();
const api = createApiClient({
  baseUrl: config.API_URL,
  token: config.AGENT_API_TOKEN,
});

// `--stdio` : client local en développement (inspecteur MCP), sans authentification
if (process.argv.includes('--stdio')) {
  await createMcpServer(api).connect(new StdioServerTransport());
  log({ msg: 'mcp-server on stdio', apiUrl: config.API_URL });
} else {
  const app = createHttpApp({
    clientToken: config.MCP_CLIENT_TOKEN,
    createMcpServer: () => createMcpServer(api),
  });
  const server = app.listen(config.MCP_PORT, () => {
    log({ msg: 'mcp-server listening', port: config.MCP_PORT, apiUrl: config.API_URL });
  });

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}
