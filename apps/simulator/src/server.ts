// Simulator control API (spec 04), proxied by the control room under `/simulation`.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { SIMULATION_SPEEDS, SimulationCommand, SimulationSpeedRequest } from '@fleet/contracts';
import { CommandRejected, type Simulation } from './simulation.ts';

const MAX_BODY_BYTES = 1_000;

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

const problem = (res: ServerResponse, status: number, message: string) =>
  send(res, status, { statusCode: status, message });

async function readJson(req: IncomingMessage): Promise<unknown> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY_BYTES) throw new SyntaxError('Body too large');
  }
  return raw === '' ? undefined : JSON.parse(raw);
}

export function createControlServer(simulation: Simulation): Server {
  return createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname.replace(/\/$/, '');
    try {
      if (req.method === 'GET' && path === '/health') return send(res, 200, { status: 'ok' });
      if (req.method === 'GET' && path === '/simulation') return send(res, 200, simulation.view());

      if (req.method === 'PUT' && path === '/simulation/speed') {
        const parsed = SimulationSpeedRequest.safeParse(await readJson(req).catch(() => null));
        if (!parsed.success) return problem(res, 400, `Invalid speed (steps: ${SIMULATION_SPEEDS.join(', ')})`);
        return send(res, 200, await simulation.setSpeed(parsed.data.speed));
      }

      const match = /^\/simulation\/([a-z]+)$/.exec(path);
      const command = match && SimulationCommand.safeParse(match[1]);
      if (req.method === 'POST' && command?.success) {
        return send(res, 200, await simulation.command(command.data));
      }
      return problem(res, 404, `Unknown route: ${req.method} ${path}`);
    } catch (error) {
      if (error instanceof CommandRejected) return problem(res, 409, error.message);
      console.error(error);
      return problem(res, 500, error instanceof Error ? error.message : String(error));
    }
  });
}
