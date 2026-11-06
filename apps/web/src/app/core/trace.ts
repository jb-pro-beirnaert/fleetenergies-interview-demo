import type { InvestigationStepView } from '@fleet/contracts';

// Vue de la trace : un appel d'outil et son résultat sont réunis en un seul élément.
export type TraceItem =
  | {
      kind: 'tool';
      id: string;
      attempt: number;
      ref: string | null;
      toolName: string | null;
      args: Record<string, unknown>;
      /** `undefined` tant que le résultat n'est pas arrivé */
      result: { ok: true; value: unknown } | { ok: false; error: string } | undefined;
      durationMs: number | null;
    }
  | { kind: 'reasoning'; id: string; attempt: number; text: string }
  | { kind: 'retry' | 'error'; id: string; attempt: number; message: string }
  | { kind: 'verdict'; id: string; attempt: number };

export interface TraceAttempt {
  attempt: number;
  items: TraceItem[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (payload: unknown, key: string): string => {
  if (isRecord(payload) && typeof payload[key] === 'string') return payload[key];
  if (typeof payload === 'string') return payload;
  return JSON.stringify(payload);
};

// Le worker peut avoir conservé l'enveloppe `{ ref, result }` vue par le modèle
const unwrap = (value: unknown): unknown =>
  isRecord(value) && 'ref' in value && 'result' in value ? value['result'] : value;

function toolResult(
  payload: unknown,
): Exclude<Extract<TraceItem, { kind: 'tool' }>['result'], undefined> {
  if (isRecord(payload)) {
    if (typeof payload['error'] === 'string') return { ok: false, error: payload['error'] };
    if ('result' in payload) return { ok: true, value: unwrap(payload['result']) };
  }
  return { ok: true, value: payload };
}

/** Regroupe les étapes par tentative, dans l'ordre, et associe chaque `tool_result` à son `tool_call`. */
export function buildTrace(steps: readonly InvestigationStepView[]): TraceAttempt[] {
  const sorted = [...steps].sort((a, b) => a.attempt - b.attempt || a.seq - b.seq);
  const attempts = new Map<number, TraceItem[]>();
  const openCalls = new Map<string, Extract<TraceItem, { kind: 'tool' }>>();

  for (const step of sorted) {
    let items = attempts.get(step.attempt);
    if (!items) attempts.set(step.attempt, (items = []));
    const base = { id: step.id, attempt: step.attempt };

    switch (step.kind) {
      case 'tool_call': {
        const args =
          isRecord(step.payload) && isRecord(step.payload['arguments'])
            ? step.payload['arguments']
            : {};
        const item: Extract<TraceItem, { kind: 'tool' }> = {
          ...base,
          kind: 'tool',
          ref: step.toolCallId,
          toolName: step.toolName,
          args,
          result: undefined,
          durationMs: null,
        };
        items.push(item);
        if (step.toolCallId) openCalls.set(`${step.attempt}:${step.toolCallId}`, item);
        break;
      }
      case 'tool_result': {
        const key = `${step.attempt}:${step.toolCallId}`;
        const call = openCalls.get(key);
        if (call) {
          call.result = toolResult(step.payload);
          call.durationMs = step.durationMs;
          openCalls.delete(key);
        } else {
          // résultat orphelin : affiché quand même
          items.push({
            ...base,
            kind: 'tool',
            ref: step.toolCallId,
            toolName: step.toolName,
            args: {},
            result: toolResult(step.payload),
            durationMs: step.durationMs,
          });
        }
        break;
      }
      case 'reasoning':
        items.push({ ...base, kind: 'reasoning', text: text(step.payload, 'text') });
        break;
      case 'retry':
      case 'error':
        items.push({ ...base, kind: step.kind, message: text(step.payload, 'message') });
        break;
      case 'verdict':
        items.push({ ...base, kind: 'verdict' });
        break;
    }
  }

  return [...attempts.entries()].map(([attempt, items]) => ({ attempt, items }));
}

/** Identifiant DOM de l'étape citée par une preuve (dernière tentative). */
export const stepAnchor = (attempt: number, ref: string) => `step-${attempt}-${ref}`;
