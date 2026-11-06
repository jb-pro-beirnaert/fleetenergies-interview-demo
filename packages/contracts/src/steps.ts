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
