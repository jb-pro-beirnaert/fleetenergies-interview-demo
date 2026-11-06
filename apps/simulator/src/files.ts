// `simulator generate --out` : écriture du jeu de données en fichiers (débogage, générateur V2).

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `data/generated/` à la racine du monorepo (ignoré par Git). */
export const DEFAULT_DATA_DIR = fileURLToPath(new URL('../../../data/generated/', import.meta.url));

export async function writeFiles(dir: string, files: Record<string, string>): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content);
  }
}
