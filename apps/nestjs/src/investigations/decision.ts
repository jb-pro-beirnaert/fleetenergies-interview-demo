import type {
  AlertDecision,
  AlertStatus,
  VerdictCategory,
} from '@fleet/contracts';

// Categories that always require a human look, whatever the confidence
export const ALWAYS_ESCALATED: ReadonlySet<VerdictCategory> = new Set([
  'theft_suspected',
  'billing_discrepancy',
  'inconclusive',
]);

/** Decision after the verdict (spec 03): rules in code, not AI. */
export function decide(
  category: VerdictCategory,
  confidence: number,
  minConfidence: number,
): AlertDecision {
  if (ALWAYS_ESCALATED.has(category)) return 'escalated';
  return confidence >= minConfidence ? 'auto_closed' : 'escalated';
}

export function statusForDecision(decision: AlertDecision): AlertStatus {
  return decision === 'auto_closed' ? 'closed' : 'escalated';
}
