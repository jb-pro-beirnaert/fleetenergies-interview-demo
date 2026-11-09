// `simulator generate --out`: writes the dataset to files (debugging, V2 generator).

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `data/generated/` at the monorepo root (ignored by Git). */
export const DEFAULT_DATA_DIR = fileURLToPath(new URL('../../../data/generated/', import.meta.url));

/** Sub-folder of the rendered invoices (`generate --out`) and of the simulator volume. */
export const INVOICES_DIR = 'live-invoices';

export async function writeFiles(dir: string, files: Record<string, string | Uint8Array>): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content);
  }
}
