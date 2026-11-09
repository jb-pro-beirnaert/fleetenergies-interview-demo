import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlertContext, StepInput, Verdict, VerdictSubmission } from '@fleet/contracts';
import type { ChatCompletionMessage, ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { ApiClient } from '../shared/api-client.js';
import { RetryableError, TaskAbandonedError } from '../shared/errors.js';
import type { ChatModel } from '../shared/llm.js';
import type { ToolProvider } from '../shared/mcp-client.js';
import { BUDGET_MESSAGE, investigate, NUDGE_MESSAGE, parseTextToolCalls } from './agent-loop.js';
import { buildUserMessage } from './prompt.js';
import { checkVerdict } from './verdict-tool.js';

const ALERT_ID = '0b9f7c1e-2d3a-4e5f-8a6b-7c8d9e0f1a2b';
const TRUCK_ID = '3f1c2a4e-8b7d-4c6a-9e5f-1a2b3c4d5e6f';
const FROM = '2026-11-05T00:00:00.000Z';
const TO = '2026-11-05T06:00:00.000Z';

const CONTEXT: AlertContext = {
  alertId: ALERT_ID,
  type: 'fuel_drop',
  truckId: TRUCK_ID,
  plate: 'AB-123-CD',
  windowStart: '2026-11-05T02:00:00.000Z',
  windowEnd: '2026-11-05T04:00:00.000Z',
  dropL: 120,
  details: { ignitionOffShare: 1 },
  detectedAt: '2026-11-05T04:05:00.000Z',
};

const VERDICT: Verdict = {
  category: 'theft_suspected',
  confidence: 0.9,
  summary: '120 L lost at night on an isolated rest area, engine off, with no refuel recorded.',
  evidence: [
    { toolCallId: 'E1', finding: 'Drop of 120 L engine off' },
    { toolCallId: 'E2', finding: 'Stop at a rest area at night' },
  ],
};

// Scripted model replies
const call = (name: string, args: unknown, id = `${name}-${Math.random()}`) =>
  ({
    role: 'assistant',
    content: null,
    refusal: null,
    tool_calls: [
      {
        id,
        type: 'function',
        function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
      },
    ],
  }) as ChatCompletionMessage;

const say = (content: string) =>
  ({ role: 'assistant', content, refusal: null }) as ChatCompletionMessage;

const windowArgs = { truckId: TRUCK_ID, from: FROM, to: TO };

// `seen[turn]`: copy of the messages sent at each turn (the loop keeps mutating its array)
function scriptedModel(replies: ChatCompletionMessage[]) {
  const seen: ChatCompletionMessageParam[][] = [];
  const complete = vi.fn<ChatModel['complete']>(async (messages) => {
    seen.push(structuredClone(messages));
    const reply = replies.shift();
    if (!reply) throw new Error('script exhausted');
    return reply;
  });
  const model: ChatModel = { name: 'fake-model', complete };
  return { ...model, complete, seen };
}

function fakeApi() {
  const steps: StepInput[] = [];
  const submissions: VerdictSubmission[] = [];
  const api = {
    claim: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
    getAlertContext: vi.fn(async () => CONTEXT),
    addStep: vi.fn(async (_alertId: string, step: StepInput) => {
      steps.push(step);
    }),
    submitVerdict: vi.fn(async (_alertId: string, submission: VerdictSubmission) => {
      submissions.push(submission);
      return {
        ok: true as const,
        outcome: { alertId: ALERT_ID, alertStatus: 'escalated' as const, decision: 'escalated' as const, alreadyCompleted: false },
      };
    }),
  } satisfies ApiClient;
  return { api, steps, submissions };
}

function fakeTools(): ToolProvider & { callTool: ReturnType<typeof vi.fn<ToolProvider['callTool']>> } {
  return {
    listTools: vi.fn(async () => [
      { name: 'get_tank_curve', description: 'Tank curve', inputSchema: { type: 'object' } },
      { name: 'get_vehicle_activity', description: 'Stops', inputSchema: { type: 'object' } },
    ]),
    callTool: vi.fn<ToolProvider['callTool']>(async (name) => ({ ok: true, result: { tool: name } })),
    close: vi.fn(async () => {}),
  };
}

describe('investigation loop', () => {
  let tools: ReturnType<typeof fakeTools>;
  let api: ReturnType<typeof fakeApi>;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    tools = fakeTools();
    api = fakeApi();
  });
  afterEach(() => vi.restoreAllMocks());

  const run = (model: ChatModel, maxToolCalls = 10) =>
    investigate(ALERT_ID, 1, { api: api.api, tools, model, maxToolCalls });

  const kinds = () => api.steps.map((step) => step.kind);
  const toolMessages = (model: ReturnType<typeof scriptedModel>, turn: number) =>
    model.seen[turn]!.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content as string));

  it('tool → tool → verdict', async () => {
    const model = scriptedModel([
      call('get_tank_curve', windowArgs),
      call('get_vehicle_activity', windowArgs),
      call('submit_verdict', VERDICT),
    ]);

    const outcome = await run(model);

    expect(outcome.decision).toBe('escalated');
    expect(kinds()).toEqual(['tool_call', 'tool_result', 'tool_call', 'tool_result', 'verdict']);
    expect(api.steps.map((s) => s.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(api.steps[0]).toMatchObject({ attempt: 1, toolName: 'get_tank_curve', toolCallId: 'E1', payload: { arguments: windowArgs } });
    expect(api.steps[3]).toMatchObject({ toolCallId: 'E2', payload: { result: { tool: 'get_vehicle_activity' } } });
    expect(api.submissions[0]).toMatchObject({ verdict: VERDICT, model: 'fake-model', promptVersion: 'investigator-v2', toolCallsCount: 2 });
    // Results are wrapped with their evidence reference
    expect(toolMessages(model, 2)).toEqual([
      { ref: 'E1', result: { tool: 'get_tank_curve' } },
      { ref: 'E2', result: { tool: 'get_vehicle_activity' } },
    ]);
  });

  it('invalid tool arguments, then correction', async () => {
    tools.callTool
      .mockResolvedValueOnce({ ok: false, error: 'to: maximum window 72 h' })
      .mockResolvedValue({ ok: true, result: { tool: 'get_tank_curve' } });
    const model = scriptedModel([
      call('get_tank_curve', { ...windowArgs, to: '2026-11-20T00:00:00Z' }),
      call('get_tank_curve', windowArgs),
      call('submit_verdict', VERDICT),
    ]);

    await run(model);

    expect(toolMessages(model, 1)).toEqual([{ ref: 'E1', error: 'to: maximum window 72 h' }]);
    expect(api.steps[1]).toMatchObject({ kind: 'tool_result', payload: { error: 'to: maximum window 72 h' } });
    expect(api.submissions).toHaveLength(1);
  });

  it('verdict citing an unknown reference, then corrected verdict', async () => {
    const wrong = { ...VERDICT, evidence: [{ toolCallId: 'E7', finding: 'Invented' }] };
    const fixed = { ...VERDICT, evidence: [VERDICT.evidence[0]!] };
    const model = scriptedModel([
      call('get_tank_curve', windowArgs),
      call('submit_verdict', wrong),
      call('submit_verdict', fixed),
    ]);

    await run(model);

    expect(kinds()).toEqual(['tool_call', 'tool_result', 'retry', 'verdict']);
    expect(api.steps[2]!.payload).toMatchObject({ message: expect.stringContaining('E7') });
    expect(toolMessages(model, 2).at(-1).error).toContain('unknown evidence references E7');
    expect(api.submissions).toHaveLength(1);
    expect(api.submissions[0]!.verdict).toEqual(fixed);
  });

  it('gives up after two invalid verdicts more', async () => {
    const wrong = { ...VERDICT, evidence: [{ toolCallId: 'E9', finding: 'Invented' }] };
    const model = scriptedModel([
      call('get_tank_curve', windowArgs),
      call('submit_verdict', wrong),
      call('submit_verdict', wrong),
      call('submit_verdict', wrong),
    ]);

    const error = await run(model).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(RetryableError);
    expect(api.submissions).toHaveLength(0);
  });

  it('text without tool call, reminder, then verdict', async () => {
    const model = scriptedModel([
      call('get_tank_curve', windowArgs),
      say('The drop looks like a theft.'),
      call('submit_verdict', { ...VERDICT, evidence: [VERDICT.evidence[0]!] }),
    ]);

    await run(model);

    expect(kinds()).toEqual(['tool_call', 'tool_result', 'reasoning', 'verdict']);
    expect(model.seen[2]!.at(-1)).toEqual({ role: 'user', content: NUDGE_MESSAGE });
  });

  it('tool call written as JSON text is treated as a call', async () => {
    const model = scriptedModel([
      say(`<tool_call>\n${JSON.stringify({ name: 'get_tank_curve', arguments: windowArgs })}\n</tool_call>`),
      call('submit_verdict', { ...VERDICT, evidence: [VERDICT.evidence[0]!] }),
    ]);

    await run(model);

    expect(kinds()).toEqual(['retry', 'tool_call', 'tool_result', 'verdict']);
    expect(tools.callTool).toHaveBeenCalledWith('get_tank_curve', windowArgs);
  });

  it('budget exhausted → inconclusive verdict built by the worker', async () => {
    const model = scriptedModel([
      call('get_tank_curve', windowArgs),
      call('get_vehicle_activity', windowArgs),
      say('I still need more data.'),
    ]);

    await run(model, 2);

    // After the budget, only submit_verdict is offered, with an explicit message
    const offered = model.complete.mock.calls[2]![1];
    expect(model.seen[2]!.at(-1)).toEqual({ role: 'user', content: BUDGET_MESSAGE });
    expect(offered.map((t) => (t.type === 'function' ? t.function.name : ''))).toEqual(['submit_verdict']);
    expect(api.submissions[0]).toMatchObject({
      verdict: { category: 'inconclusive', confidence: 0, evidence: [{ toolCallId: 'E1' }] },
      toolCallsCount: 2,
    });
  });

  it('unreachable MCP server → retryable failure', async () => {
    tools.callTool.mockRejectedValue(new RetryableError('MCP server unreachable'));
    const model = scriptedModel([call('get_tank_curve', windowArgs)]);

    await expect(run(model)).rejects.toBeInstanceOf(RetryableError);
    expect(api.submissions).toHaveLength(0);
  });

  it('404 while recording a step → task abandoned', async () => {
    api.api.addStep.mockRejectedValue(new TaskAbandonedError('investigation not found'));
    const model = scriptedModel([call('get_tank_curve', windowArgs)]);

    await expect(run(model)).rejects.toBeInstanceOf(TaskAbandonedError);
    expect(tools.callTool).not.toHaveBeenCalled();
  });
});

describe('parseTextToolCalls', () => {
  const known = new Set(['get_tank_curve', 'submit_verdict']);

  it('reads a fenced JSON block', () => {
    const text = '```json\n{"name": "get_tank_curve", "arguments": {"truckId": "x"}}\n```';
    expect(parseTextToolCalls(text, known)).toMatchObject([
      { name: 'get_tank_curve', rawArguments: '{"truckId":"x"}' },
    ]);
  });

  it('ignores plain text and unknown tools', () => {
    expect(parseTextToolCalls('The level dropped by 120 L.', known)).toEqual([]);
    expect(parseTextToolCalls('{"name": "rm_rf", "arguments": {}}', known)).toEqual([]);
  });
});

describe('V2: billing_mismatch alerts', () => {
  const BILLING: AlertContext = {
    ...CONTEXT,
    type: 'billing_mismatch',
    dropL: 160,
    details: { billedL: 412, observedRiseL: 252, gapL: 160, toleranceL: 33, cardLiters: 250, stationMatched: true, stationName: 'AS24 Valence Sud' },
  };

  it('the verdict category must explain a billing gap (checked in code)', () => {
    const refs = new Set(['E1']);
    const verdict = { ...VERDICT, evidence: [{ toolCallId: 'E1', finding: 'Tank rose by 252 L only.' }] };
    const legitimate = checkVerdict({ ...verdict, category: 'legitimate_operation' }, refs, 'billing_mismatch');
    expect(legitimate).toMatchObject({ ok: false });
    expect(!legitimate.ok && legitimate.message).toMatch(/billing_discrepancy, sensor_fault, inconclusive/);
    expect(checkVerdict({ ...verdict, category: 'billing_discrepancy' }, refs, 'billing_mismatch')).toMatchObject({ ok: true });
    // A fuel drop is never a billing discrepancy
    expect(checkVerdict({ ...verdict, category: 'billing_discrepancy' }, refs, 'fuel_drop')).toMatchObject({ ok: false });
  });

  it('the user message states the billed liters, the tank rise and the question', () => {
    const message = buildUserMessage(BILLING);
    expect(message).toContain('the invoice bills 412 L, the tank level rose by 252 L');
    expect(message).toContain('gap of 160 L');
    expect(message).toContain('EXCEEDS the tolerance (160 L > 33 L)');
    expect(message).toContain('fuel card transaction of this refuel recorded 250 L');
    expect(message).toContain('billing_discrepancy, sensor_fault, inconclusive');
  });
});
