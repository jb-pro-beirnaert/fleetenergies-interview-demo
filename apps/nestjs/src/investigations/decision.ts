import type {
  AlertDecision,
  AlertStatus,
  VerdictCategory,
} from '@fleet/contracts';

// Catégories qui exigent toujours un regard humain, quelle que soit la confiance
export const ALWAYS_ESCALATED: ReadonlySet<VerdictCategory> = new Set([
  'theft_suspected',
  'billing_discrepancy',
  'inconclusive',
]);

/** Décision après verdict (spec 03) : règles en code, pas IA. */
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
