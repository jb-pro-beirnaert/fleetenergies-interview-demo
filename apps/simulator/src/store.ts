// Simulation persistence on the simulator volume (spec 04): `state.json` and `dataset.json`.

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SimulationSpeed, SimulationStatus } from '@fleet/contracts';
import type { ActivityData } from './generate.ts';
import type { Reference } from './world.ts';

/** What the replay sends: computed once at `start`, never regenerated during the simulation. */
export interface SimDataset {
  seed: number;
  /** Demo day (D, Paris date). */
  demoDate: string;
  reference: Reference;
  history: ActivityData;
  live: ActivityData;
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

  return {
    readState: () => read<SimState>(STATE),
    writeState: (state) => write(STATE, state),
    readDataset: () => read<SimDataset>(DATASET),
    writeDataset: (dataset) => write(DATASET, dataset),
    clear() {
      const result = writes.then(async () => {
        await rm(path(STATE), { force: true });
        await rm(path(DATASET), { force: true });
      });
      writes = result.catch(() => undefined);
      return result;
    },
  };
}
