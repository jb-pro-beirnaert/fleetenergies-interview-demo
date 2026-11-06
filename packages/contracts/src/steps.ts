import { z } from 'zod';
import { StepKind } from './enums.ts';

export const StepInput = z
  .object({
    attempt: z.int().min(1),
    seq: z.int().min(0),
    kind: StepKind,
    toolName: z.string().max(100).optional(),
    toolCallId: z.string().max(100).optional(),
    payload: z.unknown(),
    durationMs: z.int().min(0).optional(),
  })
  .meta({ id: 'StepInput' });
export type StepInput = z.infer<typeof StepInput>;

export const StepInputResult = z
  .object({ created: z.boolean() })
  .meta({ id: 'StepInputResult' });
export type StepInputResult = z.infer<typeof StepInputResult>;

// Forme des `payload` selon `kind` (écrits par le worker, lus par l'écran).
// La référence de preuve ("E1"…) est portée par `toolCallId`, identique sur `tool_call` et `tool_result`.
export const ReasoningPayload = z.object({ text: z.string() });
export type ReasoningPayload = z.infer<typeof ReasoningPayload>;

export const ToolCallPayload = z.object({
  arguments: z.record(z.string(), z.unknown()),
});
export type ToolCallPayload = z.infer<typeof ToolCallPayload>;

// `result` : sortie de l'outil (tronquée à 20 Ko) ; `error` : message si l'outil a échoué
export const ToolResultPayload = z.object({
  result: z.unknown().optional(),
  error: z.string().optional(),
});
export type ToolResultPayload = z.infer<typeof ToolResultPayload>;

// `retry` et `error`
export const StepMessagePayload = z.object({ message: z.string() });
export type StepMessagePayload = z.infer<typeof StepMessagePayload>;
