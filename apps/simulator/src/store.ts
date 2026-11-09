// Simulation persistence on the simulator volume (spec 04): `state.json` and `dataset.json`.

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { SimulationSpeed, SimulationStatus } from '@fleet/contracts';
import { INVOICES_DIR } from './files.ts';
import type { ActivityData } from './generate.ts';
import type { InvoicePlan } from './invoices.ts';
import type { Reference } from './world.ts';

/** What the replay sends: computed once at `start`, never regenerated during the simulation. */
export interface SimDataset {
  seed: number;
  /** Date of the simulation start (D, Paris date). */
  demoDate: string;
  /** Demo week replayed: start (start instant rounded up to 5 min) and end (+7 days), ISO UTC. */
  liveStart: string;
  liveEnd: string;
  reference: Reference;
  history: ActivityData;
  live: ActivityData;
  /** V2: invoices of the week; their PDFs are rendered at `start` into the store. */
  invoices: InvoicePlan[];
}

export interface SimState {
  status: SimulationStatus;
  seed: number;
  demoDate: string | null;
  /** Simulated time of the last step sent (ISO). */
  clock: string | null;
  speed: SimulationSpeed;
  alertsCreated: number;
}

export interface SimStore {
  readState(): Promise<SimState | null>;
  writeState(state: SimState): Promise<void>;
  readDataset(): Promise<SimDataset | null>;
  writeDataset(dataset: SimDataset): Promise<void>;
  /** Replaces the rendered invoices (file name → PDF). */
  writeInvoices(files: ReadonlyMap<string, Uint8Array>): Promise<void>;
  readInvoice(file: string): Promise<Uint8Array | null>;
  clear(): Promise<void>;
}

const STATE = 'state.json';
const DATASET = 'dataset.json';

export function fileStore(dir: string): SimStore {
  const path = (name: string) => join(dir, name);

  async function read<T>(name: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(path(name), 'utf8')) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  /** Queued writes: two concurrent writes do not step on each other. */
  let writes: Promise<unknown> = Promise.resolve();

  /** Atomic write: a crash never leaves a half-written file. */
  function write(name: string, value: unknown): Promise<void> {
    const content = JSON.stringify(value);
    const result = writes.then(async () => {
      await mkdir(dir, { recursive: true });
      const tmp = path(`${name}.tmp`);
      await writeFile(tmp, content);
      await rename(tmp, path(name));
    });
    writes = result.catch(() => undefined);
    return result;
  }

  /** Serialised on the same queue as the JSON writes. */
  function enqueue(action: () => Promise<void>): Promise<void> {
    const result = writes.then(action);
    writes = result.catch(() => undefined);
    return result;
  }

  const invoicesDir = path(INVOICES_DIR);

  return {
    readState: () => read<SimState>(STATE),
    writeState: (state) => write(STATE, state),
    readDataset: () => read<SimDataset>(DATASET),
    writeDataset: (dataset) => write(DATASET, dataset),
    writeInvoices: (files) =>
      enqueue(async () => {
        await rm(invoicesDir, { recursive: true, force: true });
        await mkdir(invoicesDir, { recursive: true });
        for (const [name, content] of files) await writeFile(join(invoicesDir, basename(name)), content);
      }),
    async readInvoice(file) {
      try {
        return new Uint8Array(await readFile(join(invoicesDir, basename(file))));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    clear: () =>
      enqueue(async () => {
        await rm(path(STATE), { force: true });
        await rm(path(DATASET), { force: true });
        await rm(invoicesDir, { recursive: true, force: true });
      }),
  };
}
