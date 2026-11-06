import { z } from 'zod';
import { Verdict } from '@fleet/contracts';
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

// Schema validation, then every cited reference must be a tool call actually made
export function checkVerdict(args: unknown, knownRefs: ReadonlySet<string>): VerdictCheck {
  const parsed = Verdict.safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return { ok: false, message: `Invalid verdict: ${issues}. Call ${SUBMIT_VERDICT} again.` };
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
