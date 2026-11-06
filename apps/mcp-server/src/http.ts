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

// Streamable HTTP sans état : chaque POST /mcp a son propre serveur et son transport
export function createHttpApp({ clientToken, createMcpServer }: Options): Express {
  // Application Express du SDK (JSON parsé) ; écoute sur toutes les interfaces dans Docker
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
        .json(rpcError(-32001, 'Jeton manquant ou invalide'));
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
      if (!res.headersSent) res.status(500).json(rpcError(-32603, 'Erreur interne'));
    }
  });

  // Pas de session : ni flux SSE (GET) ni fermeture de session (DELETE)
  app.all('/mcp', requireToken, (_req, res) => {
    res.status(405).set('Allow', 'POST').json(rpcError(-32000, 'Méthode non autorisée'));
  });

  return app;
}
