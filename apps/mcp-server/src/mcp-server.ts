import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { ApiClient } from './api-client.js';
import { log } from './log.js';
import { TOOLS, type ToolDefinition } from './tools.js';

async function callTool(
  api: ApiClient,
  tool: ToolDefinition,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const started = performance.now();
  const { path, query } = tool.route(args);
  const result = await api.get(path, query);

  const text = result.ok ? JSON.stringify(result.data) : result.message;
  // Une ligne par appel, jamais le contenu (spec 05)
  log({
    msg: 'tool_call',
    tool: tool.name,
    durationMs: Math.round(performance.now() - started),
    status: result.ok ? 'ok' : 'error',
    apiStatus: result.status,
    bytes: Buffer.byteLength(text),
  });

  if (!result.ok) return { isError: true, content: [{ type: 'text', text }] };
  return {
    content: [{ type: 'text', text }],
    structuredContent: result.data,
  };
}

// Arguments validés par le SDK avant l'appel : schéma invalide → résultat `isError`
export function createMcpServer(api: ApiClient): McpServer {
  const server = new McpServer({ name: 'fleet-copilot-tools', version: '1.0.0' });

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.input,
        // Sans le `.meta({ id })` des contrats, sinon la racine JSON Schema est un `$ref`
        // et MCP exige `type: "object"`
        outputSchema: z.object(tool.output.shape),
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      (args: Record<string, unknown>) => callTool(api, tool, args),
    );
  }
  return server;
}
