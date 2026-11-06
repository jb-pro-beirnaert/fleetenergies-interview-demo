// Replay of the demo day (spec 04, "Replay"): splitting into steps and sending one step.
// The pace (speed, pause, stop) is driven by the simulation (`simulation.ts`).

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

/** Maximum size of the ingestion batches (contracts). */
const INGEST_BATCH_SIZE = 500;

export interface ReplayStep {
  /** Simulated time of the step (UTC instant, ms). */
  clock: number;
  telemetry: TelemetryReading[];
  refuels: FuelCardTransaction[];
  messages: DriverMessageInput[];
}

/**
 * Splits the day into steps of 5 simulated minutes. The clock step T carries everything that
 * happened in ]T − 5 min, T]. The first step (T = from) also carries everything that
 * precedes `from`: idempotent catch-up, which allows resuming an interrupted replay.
 */
export function planSteps(live: ActivityData, from: number, to: number): ReplayStep[] {
  if (to < from) throw new Error('--to must be after --from');
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

/** Order within a step: readings, card transactions, messages. */
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
