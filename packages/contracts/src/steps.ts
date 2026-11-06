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

// Shape of the `payload` by `kind` (written by the worker, read by the screen).
// The evidence reference ("E1"…) is carried by `toolCallId`, identical on `tool_call` and `tool_result`.
export const ReasoningPayload = z.object({ text: z.string() });
export type ReasoningPayload = z.infer<typeof ReasoningPayload>;

export const ToolCallPayload = z.object({
  arguments: z.record(z.string(), z.unknown()),
});
export type ToolCallPayload = z.infer<typeof ToolCallPayload>;

// `result`: tool output (truncated to 20 KB); `error`: message if the tool failed
export const ToolResultPayload = z.object({
  result: z.unknown().optional(),
  error: z.string().optional(),
});
export type ToolResultPayload = z.infer<typeof ToolResultPayload>;

// `retry` and `error`
export const StepMessagePayload = z.object({ message: z.string() });
export type StepMessagePayload = z.infer<typeof StepMessagePayload>;
