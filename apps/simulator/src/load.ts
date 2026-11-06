// Loading of the reference data and history (`preparing` state): batches of 500 for `POST /admin/history/load`.

import type { HistoryLoadBatch } from '@fleet/contracts';
import { chunk } from './api.ts';
import type { ActivityData } from './generate.ts';
import type { Reference } from './world.ts';

export const LOAD_BATCH_SIZE = 500;

/** Reference data first (foreign keys), then the activity in batches. */
export function historyBatches(reference: Reference, history: ActivityData): HistoryLoadBatch[] {
  return [
    reference,
    ...chunk(history.telemetry, LOAD_BATCH_SIZE).map((telemetry) => ({ telemetry })),
    ...chunk(history.refuels, LOAD_BATCH_SIZE).map((refuels) => ({ refuels })),
    ...chunk(history.messages, LOAD_BATCH_SIZE).map((messages) => ({ messages })),
  ];
}
