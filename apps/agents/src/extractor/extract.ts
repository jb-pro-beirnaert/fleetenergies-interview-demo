// Processing of an `extract_invoice` task (spec 06): text through the API, model call with a
// forced JSON schema, Zod validation (2 retries), normalisation in code, submission (1 retry on 422).
import type { InvoiceExtractionOutcome } from '@fleet/contracts';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { ApiClient } from '../shared/api-client.js';
import type { JsonModel } from '../shared/llm.js';
import { log } from '../shared/logger.js';
import { MODEL_JSON_SCHEMA, ModelExtraction, normalize } from './normalize.js';
import { buildMessages } from './prompt.js';

export const MAX_SCHEMA_RETRIES = 2;
export const MAX_API_RETRIES = 1;

export type ExtractionDeps = {
  api: ApiClient;
  model: JsonModel;
  signal?: AbortSignal;
};

/** Permanent failure (the task is failed as non-retryable: the invoice moves to `needs_review`). */
export class ExtractionFailedError extends Error {
  override name = 'ExtractionFailedError';
}

function issuesOf(raw: string): { value: ModelExtraction } | { problem: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { problem: 'Your answer is not valid JSON.' };
  }
  const result = ModelExtraction.safeParse(json);
  if (result.success) return { value: result.data };
  const issues = result.error.issues
    .slice(0, 8)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  return { problem: `Your answer does not match the expected format: ${issues}.` };
}

/** Model call + validation; the validation errors are sent back to the model (at most 2 retries). */
async function askModel(
  messages: ChatCompletionMessageParam[],
  { model, signal }: ExtractionDeps,
  invoiceId: string,
): Promise<ModelExtraction> {
  for (let attempt = 0; ; attempt++) {
    const raw = await model.completeJson(
      messages,
      { name: 'invoice_extraction', schema: MODEL_JSON_SCHEMA },
      signal,
    );
    const checked = issuesOf(raw);
    if ('value' in checked) return checked.value;
    log({ msg: 'extraction_invalid', invoiceId, attempt, problem: checked.problem });
    if (attempt >= MAX_SCHEMA_RETRIES) {
      throw new ExtractionFailedError(`Invalid extraction after ${MAX_SCHEMA_RETRIES} retries: ${checked.problem}`);
    }
    messages.push(
      { role: 'assistant', content: raw },
      { role: 'user', content: `${checked.problem} Answer again with the corrected JSON object only.` },
    );
  }
}

export async function extractInvoice(
  invoiceId: string,
  deps: ExtractionDeps,
): Promise<InvoiceExtractionOutcome> {
  const { text, receivedAt } = await deps.api.getInvoiceText(invoiceId);
  const messages = buildMessages(text, receivedAt);

  for (let apiAttempt = 0; ; apiAttempt++) {
    const read = await askModel(messages, deps, invoiceId);
    const extraction = normalize(read);
    const result = await deps.api.submitExtraction(invoiceId, extraction);
    if (result.ok) return result.outcome;

    log({ msg: 'extraction_rejected', invoiceId, apiAttempt, message: result.message });
    if (apiAttempt >= MAX_API_RETRIES) {
      throw new ExtractionFailedError(`Extraction rejected by the API: ${result.message}`);
    }
    messages.push(
      { role: 'assistant', content: JSON.stringify(read) },
      {
        role: 'user',
        content: `The system rejected this extraction: ${result.message}. Re-read the document and answer again with the corrected JSON object only.`,
      },
    );
  }
}
