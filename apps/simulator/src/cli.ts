// Simulator CLI (spec 04): serve | generate.

import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { SIMULATION_SPEEDS, SimulationSpeed } from '@fleet/contracts';
import { ApiClient, apiBackend, configFromEnv } from './api.ts';
import { DEFAULT_DATA_DIR, INVOICES_DIR, writeFiles } from './files.ts';
import { generate, serialize } from './generate.ts';
import { renderInvoices } from './invoice-pdf.ts';
import { createControlServer } from './server.ts';
import { Simulation } from './simulation.ts';
import { fileStore } from './store.ts';
import { localDateOf, localHHMM } from './time.ts';

const USAGE = `Usage: simulator <command> [options]

  serve                                             simulation service: control API on SIM_PORT,
                                                    driven from the control room
  generate [--seed 42] [--start ISO instant] [--out data/generated]
                                                    (debugging) simulates [start − 1 month; start + 7 days]
                                                    (start: now by default) and writes the files

Environment: API_URL (http://localhost:3000), DEVICE_TOKEN, ADMIN_TOKEN, SIM_SEED (42),
             SIM_SPEED (2000), SIM_PORT (3200), SIM_DATA_DIR (/data)`;

function parseSeed(value: string): number {
  const seed = Number(value);
  if (!Number.isInteger(seed)) throw new Error(`Invalid seed: ${value}`);
  return seed;
}

function parseStart(value: string | undefined): number {
  if (value === undefined) return Date.now();
  const startMs = Date.parse(value);
  if (Number.isNaN(startMs)) throw new Error(`Invalid start instant: ${value} (expected ISO 8601)`);
  return startMs;
}

const stamp = (utcMs: number) => `${localDateOf(utcMs)} ${localHHMM(utcMs)}`;

async function serve(env: NodeJS.ProcessEnv): Promise<never> {
  const speed = SimulationSpeed.safeParse(Number(env.SIM_SPEED ?? 2000));
  if (!speed.success) {
    throw new Error(`Invalid SIM_SPEED: ${env.SIM_SPEED} (steps: ${SIMULATION_SPEEDS.join(', ')})`);
  }
  const port = Number(env.SIM_PORT ?? 3200);
  const api = new ApiClient(configFromEnv(env));
  const simulation = new Simulation({
    backend: apiBackend(api),
    store: fileStore(env.SIM_DATA_DIR ?? '/data'),
    seed: parseSeed(env.SIM_SEED ?? '42'),
    speed: speed.data,
  });

  const server = createControlServer(simulation);
  await new Promise<void>((resolve) => server.listen(port, resolve));
  console.log(`Simulator listening on port ${port} → API ${api.config.apiUrl}`);
  const { status } = await simulation.recover();
  console.log(`State: ${status}`);

  const shutdown = () => {
    server.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return new Promise<never>(() => {});
}

async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      seed: { type: 'string', default: process.env.SIM_SEED ?? '42' },
      start: { type: 'string' },
      out: { type: 'string', default: DEFAULT_DATA_DIR },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return command || values.help ? 0 : 1;
  }

  switch (command) {
    case 'serve':
      return serve(process.env);
    case 'generate': {
      const seed = parseSeed(values.seed);
      const dataset = generate(seed, parseStart(values.start));
      await writeFiles(values.out, serialize(dataset));
      const pdfs = await renderInvoices(dataset.invoices);
      await writeFiles(join(values.out, INVOICES_DIR), {
        ...Object.fromEntries(pdfs),
        'manifest.json': `${JSON.stringify(dataset.groundTruth.invoices, null, 2)}\n`,
      });
      const cal = dataset.calendar;
      const at = (minute: number) => stamp(Date.parse(cal.toIso(minute)));
      console.log(`Seed ${seed}, from ${cal.startDate} to ${cal.endDate} (${cal.days} days, Paris time) → ${values.out}`);
      for (const [label, data] of [
        [`history (${cal.startDate} 00:00 → ${at(cal.liveStartMin)})`, dataset.history],
        [`demo week (${at(cal.liveStartMin)} → ${at(cal.liveEndMin)})`, dataset.live],
      ] as const) {
        console.log(`  ${label}: ${data.telemetry.length} readings, ${data.refuels.length} refuels, ${data.messages.length} messages`);
      }
      for (const s of dataset.groundTruth.scenarios) {
        console.log(`  ${s.id.padEnd(13)} ${s.truck} ${s.plate} ${s.localDate} ${s.localTime}  ${s.place.name}`);
      }
      console.log(`  ${pdfs.size} PDF invoices → ${join(values.out, INVOICES_DIR)}`);
      for (const i of dataset.groundTruth.invoices) {
        console.log(`  ${i.id.padEnd(13)} ${i.truck} ${i.plate} ${i.refuelAt}  ${i.template.padEnd(13)} ${i.deliveredL} L → billed ${i.billedL} L`);
      }
      return 0;
    }
    default:
      console.error(`Unknown command: ${command}\n\n${USAGE}`);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
