import type { StepInput, Verdict, VerdictOutcome } from '@fleet/contracts';
import type {
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import type { ApiClient } from '../shared/api-client.js';
import { errorMessage, RetryableError, TaskAbandonedError } from '../shared/errors.js';
import type { ChatModel } from '../shared/llm.js';
import { log } from '../shared/logger.js';
import type { ToolProvider } from '../shared/mcp-client.js';
import { buildSystemPrompt, buildUserMessage, PROMPT_VERSION } from './prompt.js';
import { checkVerdict, SUBMIT_VERDICT, verdictTool } from './verdict-tool.js';

export const MAX_VERDICT_RETRIES = 2;
export const MAX_NUDGES = 2;
// Safety net against a model that never converges (the budget normally ends the loop first)
export const MAX_TURNS = 30;
export const STEP_RESULT_MAX_BYTES = 20_000;
const STEP_SEND_ATTEMPTS = 3;

export const NUDGE_MESSAGE = 'Finish your investigation by calling submit_verdict.';
export const BUDGET_MESSAGE = 'Tool call budget reached: submit your verdict now with submit_verdict.';

export type InvestigationDeps = {
  api: ApiClient;
  tools: ToolProvider;
  model: ChatModel;
  maxToolCalls: number;
  signal?: AbortSignal;
};

type Call = { id: string; name: string; rawArguments: string };
type StepFields = Omit<StepInput, 'attempt' | 'seq'>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parseArguments(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw || '{}');
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

const toolCallsOf = (reply: ChatCompletionMessage, turn: number): Call[] =>
  (reply.tool_calls ?? []).flatMap((call, index) =>
    call.type === 'function'
      ? [
          {
            id: call.id || `call_${turn}_${index}`,
            name: call.function.name,
            rawArguments: call.function.arguments,
          },
        ]
      : [],
  );

// Small models often write the tool call as JSON in the text instead of using `tool_calls`
export function parseTextToolCalls(
  text: string,
  knownNames: ReadonlySet<string>,
  turn = 0,
): Call[] {
  const candidates = [
    ...[...text.matchAll(/<tool_call>([\s\S]*?)<\/tool_call>/g)].map((match) => match[1]),
    ...[...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((match) => match[1]),
  ];
  if (candidates.length === 0) candidates.push(text);

  const calls: Call[] = [];
  for (const candidate of candidates) {
    let value: unknown;
    try {
      value = JSON.parse(candidate!.trim());
    } catch {
      continue;
    }
    for (const item of Array.isArray(value) ? value : [value]) {
      if (!isRecord(item) || typeof item.name !== 'string' || !knownNames.has(item.name)) continue;
      const args = item.arguments ?? item.parameters ?? {};
      calls.push({
        id: `text_${turn}_${calls.length}`,
        name: item.name,
        rawArguments: typeof args === 'string' ? args : JSON.stringify(args),
      });
    }
  }
  return calls;
}

function truncateResult(result: unknown): unknown {
  const json = JSON.stringify(result) ?? '';
  if (Buffer.byteLength(json) <= STEP_RESULT_MAX_BYTES) return result;
  return `${json.slice(0, STEP_RESULT_MAX_BYTES)}… [truncated]`;
}

// Steps are sent before moving on; `tool_call` steps back the evidence, so losing one fails the task
function createRecorder(api: ApiClient, alertId: string, attempt: number) {
  let seq = 0;
  return async (fields: StepFields): Promise<void> => {
    const step: StepInput = { attempt, seq: seq++, ...fields };
    for (let tries = 1; ; tries++) {
      try {
        await api.addStep(alertId, step);
        return;
      } catch (error) {
        if (error instanceof TaskAbandonedError) throw error;
        if (tries < STEP_SEND_ATTEMPTS) continue;
        if (step.kind === 'tool_call') {
          throw new RetryableError(`Could not record tool_call step: ${errorMessage(error)}`);
        }
        log({ msg: 'step_dropped', alertId, seq: step.seq, kind: step.kind, error: errorMessage(error) });
        return;
      }
    }
  };
}

// Hand-written investigation loop (spec 06): data tools through MCP, local submit_verdict
export async function investigate(
  alertId: string,
  attempt: number,
  { api, tools, model, maxToolCalls, signal }: InvestigationDeps,
): Promise<VerdictOutcome> {
  const record = createRecorder(api, alertId, attempt);
  const context = await api.getAlertContext(alertId);

  const mcpTools = await tools.listTools();
  const dataToolNames = new Set(mcpTools.map((tool) => tool.name));
  const knownNames = new Set([...dataToolNames, SUBMIT_VERDICT]);
  const dataTools: ChatCompletionTool[] = mcpTools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
  }));

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemPrompt(maxToolCalls) },
    { role: 'user', content: buildUserMessage(context) },
  ];
  // Evidence references, in call order: E1, E2…
  const refs = new Set<string>();
  let verdictRetries = 0;
  let nudges = 0;
  let budgetNotified = false;

  async function submit(verdict: Verdict): Promise<VerdictOutcome> {
    await record({ kind: 'verdict', payload: verdict });
    const result = await api.submitVerdict(alertId, {
      verdict,
      model: model.name,
      promptVersion: PROMPT_VERSION,
      toolCallsCount: refs.size,
    });
    if (!result.ok) {
      throw new Error(`API rejected evidence references: ${result.unknownToolCallIds.join(', ')}`);
    }
    return result.outcome;
  }

  // Budget exhausted without a verdict: the worker concludes `inconclusive` itself
  async function fallbackVerdict(): Promise<VerdictOutcome> {
    if (refs.size === 0) throw new Error('No verdict and no tool call made');
    await record({ kind: 'retry', payload: { message: 'No verdict from the model: inconclusive verdict built by the worker' } });
    return submit({
      category: 'inconclusive',
      confidence: 0,
      summary: 'Tool call budget reached without a conclusion; the alert needs a human review.',
      evidence: [{ toolCallId: 'E1', finding: 'First tool call of the investigation' }],
    });
  }

  async function runDataTool(call: Call): Promise<string> {
    const args = parseArguments(call.rawArguments);
    let problem: string | null = null;
    if (!dataToolNames.has(call.name)) {
      problem = `Unknown tool "${call.name}". Available tools: ${[...knownNames].join(', ')}.`;
    } else if (!args) {
      problem = `Arguments of ${call.name} must be a JSON object.`;
    } else if (refs.size >= maxToolCalls) {
      problem = BUDGET_MESSAGE;
    }
    if (problem || !args) {
      await record({ kind: 'retry', toolName: call.name, payload: { message: problem } });
      return JSON.stringify({ error: problem });
    }

    const ref = `E${refs.size + 1}`;
    refs.add(ref);
    await record({ kind: 'tool_call', toolName: call.name, toolCallId: ref, payload: { arguments: args } });
    const started = performance.now();
    const outcome = await tools.callTool(call.name, args);
    await record({
      kind: 'tool_result',
      toolName: call.name,
      toolCallId: ref,
      durationMs: Math.round(performance.now() - started),
      payload: outcome.ok ? { result: truncateResult(outcome.result) } : { error: outcome.error },
    });
    // An error is sent back as is: the model can correct its arguments
    return JSON.stringify(outcome.ok ? { ref, result: outcome.result } : { ref, error: outcome.error });
  }

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    signal?.throwIfAborted();
    const afterBudgetNotice = budgetNotified;
    const offered = refs.size < maxToolCalls ? [...dataTools, verdictTool] : [verdictTool];
    const reply = await model.complete(messages, offered, signal);
    const text = reply.content?.trim() ?? '';

    let calls = toolCallsOf(reply, turn);
    const textCalls = calls.length === 0 && text ? parseTextToolCalls(text, knownNames, turn) : [];
    if (textCalls.length > 0) {
      calls = textCalls;
      await record({ kind: 'retry', payload: { message: 'Tool call written as text, treated as a call' } });
    } else if (text) {
      await record({ kind: 'reasoning', payload: { text } });
    }

    if (calls.length === 0) {
      if (afterBudgetNotice) return fallbackVerdict();
      if (nudges >= MAX_NUDGES) throw new Error(`No verdict after ${MAX_NUDGES} reminders`);
      nudges++;
      messages.push({ role: 'assistant', content: text });
      messages.push({ role: 'user', content: NUDGE_MESSAGE });
      continue;
    }

    messages.push({
      role: 'assistant',
      content: text || null,
      tool_calls: calls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.rawArguments },
      })),
    });

    let verdictAttempted = false;
    for (const call of calls) {
      if (call.name !== SUBMIT_VERDICT) {
        messages.push({ role: 'tool', tool_call_id: call.id, content: await runDataTool(call) });
        continue;
      }
      verdictAttempted = true;
      const args = parseArguments(call.rawArguments);
      const check = args
        ? checkVerdict(args, refs)
        : { ok: false as const, message: `Arguments of ${SUBMIT_VERDICT} must be a JSON object.` };
      if (check.ok) return submit(check.verdict);

      if (verdictRetries >= MAX_VERDICT_RETRIES) {
        throw new Error(`No valid verdict after ${MAX_VERDICT_RETRIES} retries: ${check.message}`);
      }
      verdictRetries++;
      await record({ kind: 'retry', toolName: SUBMIT_VERDICT, payload: { message: check.message } });
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: check.message }) });
    }

    if (afterBudgetNotice && !verdictAttempted) return fallbackVerdict();
    if (refs.size >= maxToolCalls && !budgetNotified) {
      budgetNotified = true;
      messages.push({ role: 'user', content: BUDGET_MESSAGE });
    }
  }
  return fallbackVerdict();
}
