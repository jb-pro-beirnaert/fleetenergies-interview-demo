import { createServer } from 'node:http';

// Squelette : les 7 outils MCP arrivent au jalon M4 (spec 05)
const port = Number(process.env.MCP_PORT ?? 3100);

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  res.writeHead(501, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_implemented' }));
});

server.listen(port, () => {
  console.log(JSON.stringify({ msg: 'mcp-server listening', port }));
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
