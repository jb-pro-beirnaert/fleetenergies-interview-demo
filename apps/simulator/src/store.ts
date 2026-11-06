// Persistance de la simulation sur le volume du simulateur (spec 04) : `state.json` et `dataset.json`.

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SimulationSpeed, SimulationStatus } from '@fleet/contracts';
import type { ActivityData } from './generate.ts';
import type { Reference } from './world.ts';

/** Ce que le rejeu envoie : calculé une fois au `start`, jamais régénéré pendant la simulation. */
export interface SimDataset {
  seed: number;
  /** Journée de démo (J, date de Paris). */
  demoDate: string;
  reference: Reference;
  history: ActivityData;
  live: ActivityData;
}

export interface SimState {
  status: SimulationStatus;
  seed: number;
  demoDate: string | null;
  /** Heure simulée du dernier pas envoyé (ISO). */
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

  /** Écritures en file : deux écritures concurrentes ne se marchent pas dessus. */
  let writes: Promise<unknown> = Promise.resolve();

  /** Écriture atomique : un plantage ne laisse jamais un fichier à moitié écrit. */
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
