import { timingSafeEqual } from 'node:crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { log } from './log.js';

function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const rpcError = (code: number, message: string) => ({
  jsonrpc: '2.0',
  error: { code, message },
  id: null,
});

type Options = {
  clientToken: string;
  createMcpServer: () => McpServer;
};

// Stateless Streamable HTTP: each POST /mcp gets its own server and transport
export function createHttpApp({ clientToken, createMcpServer }: Options): Express {
  // SDK Express application (parsed JSON); listens on all interfaces in Docker
  const app = createMcpExpressApp({ host: '0.0.0.0' });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const requireToken = (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token || !sameToken(token, clientToken)) {
      res
        .status(401)
        .set('WWW-Authenticate', 'Bearer')
        .json(rpcError(-32001, 'Missing or invalid token'));
      return;
    }
    next();
  };

  app.post('/mcp', requireToken, async (req, res) => {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      log({ msg: 'mcp_request_failed', error: String(error) });
      if (!res.headersSent) res.status(500).json(rpcError(-32603, 'Internal error'));
    }
  });

  // No session: neither SSE stream (GET) nor session termination (DELETE)
  app.all('/mcp', requireToken, (_req, res) => {
    res.status(405).set('Allow', 'POST').json(rpcError(-32000, 'Method not allowed'));
  });

  return app;
}
