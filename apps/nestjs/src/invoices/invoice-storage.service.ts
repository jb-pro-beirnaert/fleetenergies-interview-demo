import { Inject, Injectable } from '@nestjs/common';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { APP_CONFIG, type AppConfig } from '../config/config.js';

/** Received PDFs, one file per invoice (`<id>.pdf`) in `INVOICE_STORAGE_DIR` (Docker volume). */
@Injectable()
export class InvoiceStorage {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private get dir() {
    return this.config.INVOICE_STORAGE_DIR;
  }

  /** Atomic write (temporary file, then rename); returns the stored path. */
  async save(invoiceId: string, content: Uint8Array): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const path = join(this.dir, `${invoiceId}.pdf`);
    const tmp = `${path}.tmp`;
    await writeFile(tmp, content);
    await rename(tmp, path);
    return path;
  }

  read(path: string): Promise<Buffer> {
    return readFile(path);
  }

  remove(path: string): Promise<void> {
    return rm(path, { force: true });
  }

  /** Deletes every stored file (full reset, `/admin/wipe`). */
  async clear(): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    await Promise.all(
      names.map((name) => rm(join(this.dir, name), { recursive: true, force: true })),
    );
  }
}
