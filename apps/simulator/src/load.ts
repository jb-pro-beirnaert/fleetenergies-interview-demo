// Loading of the reference data and history (`preparing` state): batches of 500 for `POST /admin/history/load`.

import type { HistoryLoadBatch } from '@fleet/contracts';
import { chunk } from './api.ts';
import type { ActivityData } from './generate.ts';
import type { Reference } from './world.ts';

export const LOAD_BATCH_SIZE = 500;
/** Assignments (one per truck and per day): their number grows with the period, so they get their own batches. */
const ASSIGNMENT_BATCH_SIZE = 200;

/** Reference data first (foreign keys), then the assignments, then the activity in batches. */
export function historyBatches(reference: Reference, history: ActivityData): HistoryLoadBatch[] {
  const { assignments, ...entities } = reference;
  return [
    entities,
    ...chunk(assignments, ASSIGNMENT_BATCH_SIZE).map((batch) => ({ assignments: batch })),
    ...chunk(history.telemetry, LOAD_BATCH_SIZE).map((telemetry) => ({ telemetry })),
    ...chunk(history.refuels, LOAD_BATCH_SIZE).map((refuels) => ({ refuels })),
    ...chunk(history.messages, LOAD_BATCH_SIZE).map((messages) => ({ messages })),
  ];
}
