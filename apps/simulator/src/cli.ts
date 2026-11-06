// Simulator CLI (spec 04): serve | generate.

import { parseArgs } from 'node:util';
import { SimulationSpeed } from '@fleet/contracts';
import { ApiClient, apiBackend, configFromEnv } from './api.ts';
import { DEFAULT_DATA_DIR, writeFiles } from './files.ts';
import { generate, serialize } from './generate.ts';
import { createControlServer } from './server.ts';
import { Simulation } from './simulation.ts';
import { fileStore } from './store.ts';
import { assertDate, parseHHMM, todayInParis } from './time.ts';

const USAGE = `Usage: simulator <command> [options]

  serve                                             simulation service: control API on SIM_PORT,
                                                    driven from the control room
  generate [--seed 42] [--today YYYY-MM-DD] [--out data/generated]
                                                    (debugging) simulates [today − 1 month; today]
                                                    (Paris time) and writes the files

Environment: API_URL (http://localhost:3000), DEVICE_TOKEN, ADMIN_TOKEN, SIM_SEED (42),
             SIM_SPEED (120), SIM_FROM (02:00), SIM_PORT (3200), SIM_DATA_DIR (/data)`;

/** End of the replay (Paris time). */
const REPLAY_END = '23:55';

function parseSeed(value: string): number {
  const seed = Number(value);
  if (!Number.isInteger(seed)) throw new Error(`Graine invalide : ${value}`);
  return seed;
}

async function serve(env: NodeJS.ProcessEnv): Promise<never> {
  const speed = SimulationSpeed.safeParse(Number(env.SIM_SPEED ?? 120));
  if (!speed.success) throw new Error(`SIM_SPEED invalide : ${env.SIM_SPEED} (paliers : 30, 60, 120, 300, 600)`);
  const port = Number(env.SIM_PORT ?? 3200);
  const api = new ApiClient(configFromEnv(env));
  const simulation = new Simulation({
    backend: apiBackend(api),
    store: fileStore(env.SIM_DATA_DIR ?? '/data'),
    seed: parseSeed(env.SIM_SEED ?? '42'),
    speed: speed.data,
    fromMin: parseHHMM(env.SIM_FROM ?? '02:00'),
    toMin: parseHHMM(REPLAY_END),
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
      today: { type: 'string' },
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
      const today = assertDate(values.today ?? todayInParis());
      const dataset = generate(seed, today);
      await writeFiles(values.out, serialize(dataset));
      const cal = dataset.calendar;
      console.log(`Seed ${seed}, from ${cal.startDate} to ${cal.demoDate} (${cal.days} days, Paris time) → ${values.out}`);
      for (const [label, data] of [
        [`historique (${cal.startDate} → ${cal.date(cal.liveDay - 1)})`, dataset.history],
        [`demo day (${cal.demoDate})`, dataset.live],
      ] as const) {
        console.log(`  ${label}: ${data.telemetry.length} readings, ${data.refuels.length} refuels, ${data.messages.length} messages`);
      }
      for (const s of dataset.groundTruth.scenarios) {
        console.log(`  ${s.id.padEnd(13)} ${s.truck} ${s.plate} ${s.localTime}  ${s.place.name}`);
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
