// Rejeu de la journée de démo (spec 04, « Rejeu ») : découpage en pas et envoi d'un pas.
// La cadence (vitesse, pause, arrêt) est pilotée par la simulation (`simulation.ts`).

import type {
  DriverMessageInput,
  FuelCardTransaction,
  IngestResult,
  TelemetryIngestResult,
  TelemetryReading,
} from '@fleet/contracts';
import { chunk, type ApiClient } from './api.ts';
import type { ActivityData } from './generate.ts';
import { STEP_MS } from './time.ts';

/** Taille maximale des lots d'ingestion (contrats). */
const INGEST_BATCH_SIZE = 500;

export interface ReplayStep {
  /** Heure simulée du pas (instant UTC, ms). */
  clock: number;
  telemetry: TelemetryReading[];
  refuels: FuelCardTransaction[];
  messages: DriverMessageInput[];
}

/**
 * Découpe la journée en pas de 5 minutes simulées. Le pas d'horloge T porte tout ce qui
 * s'est produit dans ]T − 5 min, T]. Le premier pas (T = from) porte aussi tout ce qui
 * précède `from` : rattrapage idempotent, qui permet de reprendre un rejeu interrompu.
 */
export function planSteps(live: ActivityData, from: number, to: number): ReplayStep[] {
  if (to < from) throw new Error('--to doit être postérieur à --from');
  const count = Math.floor((to - from) / STEP_MS) + 1;
  const steps: ReplayStep[] = Array.from({ length: count }, (_, i) => ({
    clock: from + i * STEP_MS,
    telemetry: [],
    refuels: [],
    messages: [],
  }));
  const stepOf = (iso: string): ReplayStep | undefined => {
    const instant = Date.parse(iso);
    return steps[instant <= from ? 0 : Math.ceil((instant - from) / STEP_MS)];
  };
  for (const reading of live.telemetry) stepOf(reading.recordedAt)?.telemetry.push(reading);
  for (const refuel of live.refuels) stepOf(refuel.occurredAt)?.refuels.push(refuel);
  for (const message of live.messages) stepOf(message.sentAt)?.messages.push(message);
  return steps;
}

/** Ordre dans un pas : relevés, transactions carte, messages. */
export async function sendStep(api: ApiClient, step: ReplayStep): Promise<number> {
  let alerts = 0;
  for (const readings of chunk(step.telemetry, INGEST_BATCH_SIZE)) {
    const result = await api.post<TelemetryIngestResult>('/api/telemetry', 'device', { readings, source: 'live' });
    alerts += result.alertsCreated;
  }
  for (const transactions of chunk(step.refuels, INGEST_BATCH_SIZE)) {
    await api.post<IngestResult>('/api/fuel-card-transactions', 'device', { transactions, source: 'live' });
  }
  for (const messages of chunk(step.messages, INGEST_BATCH_SIZE)) {
    await api.post<IngestResult>('/api/driver-messages', 'device', { messages, source: 'live' });
  }
  return alerts;
}
