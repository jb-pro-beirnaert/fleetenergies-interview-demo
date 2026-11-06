// `simulator load` : référentiel + historique vers POST /admin/history/load, par lots de 500.

import type { HistoryLoadBatch, HistoryLoadResult } from '@fleet/contracts';
import { chunk, type ApiClient } from './api.ts';
import { readActivity, readReference } from './files.ts';

export const LOAD_BATCH_SIZE = 500;

type Counts = HistoryLoadResult['inserted'];

export async function load(api: ApiClient, dataDir: string): Promise<Counts> {
  const reference = await readReference(dataDir);
  const history = await readActivity(dataDir, 'history');

  // Référentiel d'abord (clés étrangères), puis l'activité par lots
  const batches: HistoryLoadBatch[] = [
    reference,
    ...chunk(history.telemetry, LOAD_BATCH_SIZE).map((telemetry) => ({ telemetry })),
    ...chunk(history.refuels, LOAD_BATCH_SIZE).map((refuels) => ({ refuels })),
    ...chunk(history.messages, LOAD_BATCH_SIZE).map((messages) => ({ messages })),
  ];

  const total: Counts = {
    carriers: 0, places: 0, trucks: 0, drivers: 0, assignments: 0, telemetry: 0, refuels: 0, messages: 0,
  };
  for (const [index, batch] of batches.entries()) {
    const { inserted } = await api.post<HistoryLoadResult>('/admin/history/load', 'admin', batch);
    for (const key of Object.keys(total) as (keyof Counts)[]) total[key] += inserted[key];
    if ((index + 1) % 10 === 0 || index === batches.length - 1) {
      process.stdout.write(`\r  lots envoyés : ${index + 1}/${batches.length}`);
    }
  }
  process.stdout.write('\n');
  return total;
}
