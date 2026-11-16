import { z } from 'zod';
import { MAX_EVIDENCE, Verdict, type AlertType, type VerdictCategory } from '@fleet/contracts';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';

export const SUBMIT_VERDICT = 'submit_verdict';

// Rebuilt without the contract's `.meta({ id })`, otherwise the JSON Schema root is a `$ref`
const { $schema: _, ...parameters } = z.toJSONSchema(z.object(Verdict.shape));

// Local tool, not on the MCP server: it is the agent's output, not a data source
export const verdictTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: SUBMIT_VERDICT,
    description:
      'Submit the final verdict of the investigation. Mandatory last step. ' +
      'Each evidence item cites the reference ("E1", "E2"…) of a tool result you received.',
    parameters,
  },
};

export type VerdictCheck = { ok: true; verdict: Verdict } | { ok: false; message: string };

/**
 * Categories that can explain each alert type (checked in code). A billing gap is a difference
 * between an invoice and the tank: a theft, a transfer or a workshop job do not explain it.
 */
export const ALLOWED_CATEGORIES: Record<AlertType, readonly VerdictCategory[]> = {
  fuel_drop: ['theft_suspected', 'sensor_fault', 'equipment_transfer', 'legitimate_operation', 'inconclusive'],
  billing_mismatch: ['billing_discrepancy', 'sensor_fault', 'inconclusive'],
};

/** Facts read from the tool results (computed by the API), used to reject a category they contradict. */
export type InvestigationFacts = {
  tankCurveSeen: boolean;
  levelRecovered: boolean;
  profileSeen: boolean;
  sensorNotes: boolean;
  hasReefer: boolean;
  messagesSeen: boolean;
  hasMessages: boolean;
};

export const emptyFacts = (): InvestigationFacts => ({
  tankCurveSeen: false,
  levelRecovered: false,
  profileSeen: false,
  sensorNotes: false,
  hasReefer: false,
  messagesSeen: false,
  hasMessages: false,
});

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

export function collectFacts(facts: InvestigationFacts, toolName: string, result: unknown): void {
  const r = asRecord(result);
  if (toolName === 'get_tank_curve') {
    facts.tankCurveSeen = true;
    if (Array.isArray(r.recoveries) && r.recoveries.length > 0) facts.levelRecovered = true;
  } else if (toolName === 'get_truck_profile') {
    facts.profileSeen = true;
    facts.sensorNotes = typeof r.sensorNotes === 'string' && r.sensorNotes.trim() !== '';
    facts.hasReefer = r.hasReefer === true;
  } else if (toolName === 'read_driver_messages') {
    facts.messagesSeen = true;
    if (Array.isArray(r.messages) && r.messages.length > 0) facts.hasMessages = true;
  }
}

// Small models sometimes pick a category their own evidence contradicts: the code checks the
// required clue of each benign category (fuel_drop alerts only; spec 06, "Verdict guardrails")
function contradiction(category: VerdictCategory, facts: InvestigationFacts): string | null {
  if (category === 'sensor_fault' && facts.tankCurveSeen && !facts.levelRecovered && !facts.sensorNotes) {
    return (
      'sensor_fault requires the level to recover without a refuel or known sensor notes, but the tank curve shows ' +
      'no recovery ("recoveries" is empty)' +
      (facts.profileSeen ? ' and the truck has no sensor notes' : ' (call get_truck_profile to check sensor notes)') +
      '. A drop that stays low is not a sensor fault'
    );
  }
  if (category === 'equipment_transfer' && facts.profileSeen && !facts.hasReefer) {
    return 'equipment_transfer requires equipment fed by the tank, but the truck has no reefer unit (hasReefer is false)';
  }
  if (category === 'legitimate_operation' && facts.messagesSeen && !facts.hasMessages) {
    return 'legitimate_operation requires a driver message about a planned intervention, but there is no driver message over the period';
  }
  return null;
}

// Schema validation, allowed category, consistency with the facts, then every cited reference
// must be a tool call actually made
export function checkVerdict(
  args: unknown,
  knownRefs: ReadonlySet<string>,
  alertType: AlertType = 'fuel_drop',
  facts: InvestigationFacts = emptyFacts(),
): VerdictCheck {
  // Too many evidence items: the generic Zod message ("Too big") makes small models repeat the mistake
  const evidence = (args as { evidence?: unknown } | null)?.evidence;
  if (Array.isArray(evidence) && evidence.length > MAX_EVIDENCE) {
    return {
      ok: false,
      message:
        `Invalid verdict: ${evidence.length} evidence items, at most ${MAX_EVIDENCE} are allowed. ` +
        `Keep only the most decisive ones (one per tool result). Call ${SUBMIT_VERDICT} again.`,
    };
  }
  const parsed = Verdict.safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return { ok: false, message: `Invalid verdict: ${issues}. Call ${SUBMIT_VERDICT} again.` };
  }
  const allowed = ALLOWED_CATEGORIES[alertType];
  if (!allowed.includes(parsed.data.category)) {
    return {
      ok: false,
      message:
        `Invalid verdict: category "${parsed.data.category}" does not apply to a ${alertType} alert. ` +
        `Choose one of: ${allowed.join(', ')}. Call ${SUBMIT_VERDICT} again.`,
    };
  }
  const conflict = alertType === 'fuel_drop' ? contradiction(parsed.data.category, facts) : null;
  if (conflict) {
    return {
      ok: false,
      message: `Invalid verdict: ${conflict}. Choose another category. Call ${SUBMIT_VERDICT} again.`,
    };
  }
  const unknown = parsed.data.evidence
    .map((evidence) => evidence.toolCallId)
    .filter((ref) => !knownRefs.has(ref));
  if (unknown.length > 0) {
    const known = [...knownRefs].join(', ') || 'none';
    return {
      ok: false,
      message:
        `Invalid verdict: unknown evidence references ${unknown.join(', ')}. ` +
        `Only cite references of tool results you received (${known}). Call ${SUBMIT_VERDICT} again.`,
    };
  }
  return { ok: true, verdict: parsed.data };
}
