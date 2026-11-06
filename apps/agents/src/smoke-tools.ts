// Checks that the model calls a dummy tool with valid arguments (spec 06, first test to run).
// Runs on the host: `npm run smoke:tools -w apps/agents` (Ollama on localhost by default).
import { createChatModel } from './shared/llm.js';

const model = createChatModel({
  baseUrl: process.env.SMOKE_LLM_BASE_URL ?? 'http://localhost:11434/v1',
  apiKey: process.env.LLM_API_KEY ?? 'ollama',
  model: process.env.LLM_MODEL ?? 'fleet-qwen',
});

const TRUCK_ID = '3f1c2a4e-8b7d-4c6a-9e5f-1a2b3c4d5e6f';

const reply = await model.complete(
  [
    { role: 'system', content: 'You are a fleet assistant. Use the tools to answer.' },
    {
      role: 'user',
      content: `What was the tank level of truck "${TRUCK_ID}" between 2026-11-05T08:00:00Z and 2026-11-05T12:00:00Z?`,
    },
  ],
  [
    {
      type: 'function',
      function: {
        name: 'get_tank_level',
        description: 'Tank level of a truck over a period.',
        parameters: {
          type: 'object',
          properties: {
            truckId: { type: 'string', description: 'Truck identifier' },
            from: { type: 'string', description: 'Start, ISO 8601 with time zone' },
            to: { type: 'string', description: 'End, ISO 8601 with time zone' },
          },
          required: ['truckId', 'from', 'to'],
        },
      },
    },
  ],
);

const call = reply.tool_calls?.find((c) => c.type === 'function');
const problems: string[] = [];
let args: Record<string, unknown> = {};
if (!call || call.type !== 'function') {
  problems.push(`no tool call (text: ${JSON.stringify(reply.content)})`);
} else {
  if (call.function.name !== 'get_tank_level') problems.push(`wrong tool: ${call.function.name}`);
  try {
    args = JSON.parse(call.function.arguments) as Record<string, unknown>;
  } catch {
    problems.push(`arguments are not JSON: ${call.function.arguments}`);
  }
  if (args.truckId !== TRUCK_ID) problems.push(`wrong truckId: ${String(args.truckId)}`);
  for (const key of ['from', 'to']) {
    if (typeof args[key] !== 'string' || Number.isNaN(Date.parse(args[key]))) {
      problems.push(`invalid ${key}: ${String(args[key])}`);
    }
  }
}

console.log(JSON.stringify({ model: model.name, toolCall: call ?? null, problems }, null, 2));
if (problems.length > 0) {
  console.error('smoke:tools FAILED');
  process.exit(1);
}
console.log('smoke:tools OK');
