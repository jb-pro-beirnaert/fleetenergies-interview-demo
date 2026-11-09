import { hostname } from 'node:os';
import { ExtractInvoicePayload } from '@fleet/contracts';
import { extractInvoice } from './extractor/extract.js';
import { PROMPT_VERSION } from './extractor/prompt.js';
import { createApiClient } from './shared/api-client.js';
import { loadConfig } from './shared/config.js';
import { createJsonModel } from './shared/llm.js';
import { log } from './shared/logger.js';
import { runWorker } from './shared/worker-loop.js';

// V2 invoice extractor (spec 06): not an agent — one model call with a forced output format
const config = loadConfig();
const workerId = `${hostname()}-${process.pid}`;
const api = createApiClient({ baseUrl: config.API_URL, token: config.AGENT_API_TOKEN });
const model = createJsonModel({
  baseUrl: config.LLM_BASE_URL,
  apiKey: config.LLM_API_KEY,
  model: config.LLM_MODEL,
});

const stop = new AbortController();
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    log({ msg: 'extractor_stopping', signal });
    stop.abort();
  });
}

log({ msg: 'extractor_started', workerId, model: model.name, promptVersion: PROMPT_VERSION });

await runWorker({
  api,
  type: 'extract_invoice',
  workerId,
  pollIntervalMs: config.POLL_INTERVAL_MS,
  stop: stop.signal,
  async handle(task, signal) {
    const { invoiceId } = ExtractInvoicePayload.parse(task.payload);
    const outcome = await extractInvoice(invoiceId, { api, model, signal });
    log({
      msg: 'extraction_submitted',
      invoiceId,
      status: outcome.status,
      suspicious: outcome.suspicious,
      alertId: outcome.alertId,
    });
  },
});

log({ msg: 'extractor_stopped' });
