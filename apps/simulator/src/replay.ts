// `simulator replay` : rejoue la journée de démo en accéléré (spec 04, « Rejeu »).

import type {
  DriverMessageInput,
  FuelCardTransaction,
  IngestResult,
  TelemetryIngestResult,
  TelemetryReading,
} from '@fleet/contracts';
import { chunk, type ApiClient } from './api.ts';
import type { ActivityData } from './generate.ts';
import { STEP_MS, localHHMM } from './time.ts';

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

export interface ReplayOptions {
  /** Instants UTC (ms) de début et de fin du rejeu. */
  from: number;
  to: number;
  speed: number;
  signal?: AbortSignal;
  log?: (line: string) => void;
}

export interface ReplayResult {
  completed: boolean;
  /** Dernier pas envoyé (pour reprendre avec --from). */
  lastClock: number | null;
  alertsCreated: number;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });

/** Ordre dans un pas : relevés, transactions carte, messages. */
async function sendStep(api: ApiClient, step: ReplayStep): Promise<number> {
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

export async function replay(api: ApiClient, live: ActivityData, options: ReplayOptions): Promise<ReplayResult> {
  const log = options.log ?? console.log;
  const steps = planSteps(live, options.from, options.to);
  const stepMs = STEP_MS / options.speed;
  const startedAt = performance.now();
  let alertsCreated = 0;
  let lastClock: number | null = null;

  for (const [index, step] of steps.entries()) {
    if (options.signal?.aborted) return { completed: false, lastClock, alertsCreated };
    const alerts = await sendStep(api, step);
    alertsCreated += alerts;
    lastClock = step.clock;
    log(
      `${localHHMM(step.clock)} │ relevés ${String(step.telemetry.length).padStart(3)} · pleins ${step.refuels.length} · messages ${step.messages.length} │ ` +
        (alerts > 0 ? `alertes +${alerts} (total ${alertsCreated}) 🚨` : `alertes ${alertsCreated}`),
    );
    await sleep(startedAt + (index + 1) * stepMs - performance.now(), options.signal);
  }
  return { completed: true, lastClock, alertsCreated };
}
