import type {
  AlertDecision,
  AlertStatus,
  AlertType,
  VerdictCategory,
} from '@fleet/contracts';

// Categories that always require a human look, whatever the confidence
export const ALWAYS_ESCALATED: ReadonlySet<VerdictCategory> = new Set([
  'theft_suspected',
  'billing_discrepancy',
  'inconclusive',
]);

/**
 * Decision after the verdict (spec 03): rules in code, not AI.
 * V2: a billing discrepancy (gap computed by code between an invoice and the tank) is about
 * money owed to a supplier: always reviewed by a human, whatever the agent concludes.
 */
export function decide(
  category: VerdictCategory,
  confidence: number,
  minConfidence: number,
  alertType: AlertType = 'fuel_drop',
): AlertDecision {
  if (alertType === 'billing_mismatch') return 'escalated';
  if (ALWAYS_ESCALATED.has(category)) return 'escalated';
  return confidence >= minConfidence ? 'auto_closed' : 'escalated';
}

export function statusForDecision(decision: AlertDecision): AlertStatus {
  return decision === 'auto_closed' ? 'closed' : 'escalated';
}
