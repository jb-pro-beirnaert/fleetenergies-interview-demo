import { hostname } from 'node:os';
import { InvestigateAlertPayload } from '@fleet/contracts';
import { investigate } from './investigator/agent-loop.js';
import { PROMPT_VERSION } from './investigator/prompt.js';
import { createApiClient } from './shared/api-client.js';
import { loadConfig } from './shared/config.js';
import { createChatModel } from './shared/llm.js';
import { log } from './shared/logger.js';
import { connectMcp } from './shared/mcp-client.js';
import { runWorker } from './shared/worker-loop.js';

const config = loadConfig();
const workerId = `${hostname()}-${process.pid}`;
const api = createApiClient({ baseUrl: config.API_URL, token: config.AGENT_API_TOKEN });
const model = createChatModel({
  baseUrl: config.LLM_BASE_URL,
  apiKey: config.LLM_API_KEY,
  model: config.LLM_MODEL,
});

const stop = new AbortController();
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    log({ msg: 'investigator_stopping', signal });
    stop.abort();
  });
}

log({ msg: 'investigator_started', workerId, model: model.name, promptVersion: PROMPT_VERSION });

await runWorker({
  api,
  type: 'investigate_alert',
  workerId,
  pollIntervalMs: config.POLL_INTERVAL_MS,
  stop: stop.signal,
  async handle(task, signal) {
    const { alertId } = InvestigateAlertPayload.parse(task.payload);
    const tools = await connectMcp(config.MCP_URL, config.MCP_CLIENT_TOKEN);
    try {
      const outcome = await investigate(alertId, task.attempts, {
        api,
        tools,
        model,
        maxToolCalls: config.MAX_TOOL_CALLS,
        signal,
      });
      log({ msg: 'verdict_submitted', ...outcome });
    } finally {
      await tools.close();
    }
  },
});

log({ msg: 'investigator_stopped' });
