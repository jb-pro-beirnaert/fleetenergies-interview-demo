import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  DriverMessageInput,
  FuelCardTransaction,
  TelemetryReading,
} from '@fleet/contracts';
import { FILES, type ActivityData, type GroundTruth } from './generate.ts';
import type { Reference } from './world.ts';

/** `data/generated/` à la racine du monorepo (fichiers versionnés). */
export const DEFAULT_DATA_DIR = fileURLToPath(new URL('../../../data/generated/', import.meta.url));

export async function writeFiles(dir: string, files: Record<string, string>): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content);
  }
}

async function readJson<T>(dir: string, name: string): Promise<T> {
  try {
    return JSON.parse(await readFile(join(dir, name), 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Fichier manquant : ${join(dir, name)} — lancer d'abord « simulator generate »`);
    }
    throw error;
  }
}

async function readNdjson<T>(dir: string, name: string): Promise<T[]> {
  const content = await readFile(join(dir, name), 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      throw new Error(`Fichier manquant : ${join(dir, name)} — lancer d'abord « simulator generate »`);
    }
    throw error;
  });
  return content
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as T);
}

export const readReference = (dir: string) => readJson<Reference>(dir, FILES.reference);
export const readGroundTruth = (dir: string) => readJson<GroundTruth>(dir, FILES.groundTruth);

export async function readActivity(dir: string, period: 'history' | 'live'): Promise<ActivityData> {
  const names =
    period === 'history'
      ? [FILES.historyTelemetry, FILES.historyRefuels, FILES.historyMessages]
      : [FILES.liveTelemetry, FILES.liveRefuels, FILES.liveMessages];
  return {
    telemetry: await readNdjson<TelemetryReading>(dir, names[0]),
    refuels: await readJson<FuelCardTransaction[]>(dir, names[1]),
    messages: await readJson<DriverMessageInput[]>(dir, names[2]),
  };
}
