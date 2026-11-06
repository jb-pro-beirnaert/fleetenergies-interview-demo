import { z } from 'zod';
import { AlertDecision, AlertStatus, VerdictCategory } from './enums.ts';

export const Evidence = z.object({
  // Référence "E1", "E2"… attribuée par le worker ; doit correspondre à une étape `tool_call`
  toolCallId: z.string().min(1).max(20),
  finding: z.string().min(1).max(200),
});
export type Evidence = z.infer<typeof Evidence>;

export const Verdict = z
  .object({
    category: VerdictCategory,
    confidence: z.number().min(0).max(1),
    summary: z.string().min(40).max(600),
    evidence: z.array(Evidence).min(1).max(6),
  })
  .meta({ id: 'Verdict' });
export type Verdict = z.infer<typeof Verdict>;

export const VerdictSubmission = z
  .object({
    verdict: Verdict,
    model: z.string().min(1).max(100),
    promptVersion: z.string().min(1).max(100),
    toolCallsCount: z.int().min(0),
  })
  .meta({ id: 'VerdictSubmission' });
export type VerdictSubmission = z.infer<typeof VerdictSubmission>;

export const VerdictOutcome = z
  .object({
    alertId: z.uuid(),
    alertStatus: AlertStatus,
    decision: AlertDecision.nullable(),
    alreadyCompleted: z.boolean(),
  })
  .meta({ id: 'VerdictOutcome' });
export type VerdictOutcome = z.infer<typeof VerdictOutcome>;
