import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { RetryableError } from './errors.js';

export const MCP_TIMEOUT_MS = 30_000;

export type ToolSpec = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

// `ok: false`: the tool answered with an error (invalid arguments, 4xx from the API…),
// sent back as is to the model so it can correct itself
export type ToolCallResult =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

// Investigation tools as seen by the agent; an unreachable server throws a RetryableError
export type ToolProvider = {
  listTools(): Promise<ToolSpec[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult>;
  close(): Promise<void>;
};

const textOf = (result: CallToolResult): string =>
  result.content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('\n')
    .trim();

function parseText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// One connection per task: the MCP server is stateless
export async function connectMcp(url: string, token: string): Promise<ToolProvider> {
  const client = new Client({ name: 'fleet-investigator', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  try {
    await client.connect(transport);
  } catch (error) {
    throw new RetryableError(`MCP server unreachable: ${String(error)}`);
  }

  return {
    async listTools() {
      try {
        const { tools } = await client.listTools(undefined, { timeout: MCP_TIMEOUT_MS });
        return tools.map((tool) => ({
          name: tool.name,
          description: tool.description ?? '',
          inputSchema: tool.inputSchema as Record<string, unknown>,
        }));
      } catch (error) {
        throw new RetryableError(`MCP listTools failed: ${String(error)}`);
      }
    },

    async callTool(name, args) {
      let result: CallToolResult;
      try {
        result = (await client.callTool({ name, arguments: args }, undefined, {
          timeout: MCP_TIMEOUT_MS,
        })) as CallToolResult;
      } catch (error) {
        throw new RetryableError(`MCP call to ${name} failed: ${String(error)}`);
      }
      if (result.isError) return { ok: false, error: textOf(result) || 'tool error' };
      return { ok: true, result: result.structuredContent ?? parseText(textOf(result)) };
    },

    async close() {
      await client.close().catch(() => {});
    },
  };
}
