// Chargement du référentiel et de l'historique (état `preparing`) : lots de 500 pour `POST /admin/history/load`.

import type { HistoryLoadBatch } from '@fleet/contracts';
import { chunk } from './api.ts';
import type { ActivityData } from './generate.ts';
import type { Reference } from './world.ts';

export const LOAD_BATCH_SIZE = 500;

/** Référentiel d'abord (clés étrangères), puis l'activité par lots. */
export function historyBatches(reference: Reference, history: ActivityData): HistoryLoadBatch[] {
  return [
    reference,
    ...chunk(history.telemetry, LOAD_BATCH_SIZE).map((telemetry) => ({ telemetry })),
    ...chunk(history.refuels, LOAD_BATCH_SIZE).map((refuels) => ({ refuels })),
    ...chunk(history.messages, LOAD_BATCH_SIZE).map((messages) => ({ messages })),
  ];
}
