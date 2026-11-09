import OpenAI from 'openai';
import type {
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { RetryableError } from './errors.js';

export const LLM_TIMEOUT_MS = 90_000;

export type ChatModel = {
  readonly name: string;
  complete(
    messages: ChatCompletionMessageParam[],
    tools: ChatCompletionTool[],
    signal?: AbortSignal,
  ): Promise<ChatCompletionMessage>;
};

// V2 extractor: one call whose output is forced to a JSON schema (no tools)
export type JsonModel = {
  readonly name: string;
  completeJson(
    messages: ChatCompletionMessageParam[],
    schema: { name: string; schema: Record<string, unknown> },
    signal?: AbortSignal,
  ): Promise<string>;
};

type Options = { baseUrl: string; apiKey: string; model: string };

// Ollama "structured output" through the OpenAI-compatible API (`response_format: json_schema`)
export function createJsonModel({ baseUrl, apiKey, model }: Options): JsonModel {
  const client = new OpenAI({ baseURL: baseUrl, apiKey, timeout: LLM_TIMEOUT_MS, maxRetries: 1 });
  return {
    name: model,
    async completeJson(messages, { name, schema }, signal) {
      try {
        const response = await client.chat.completions.create(
          {
            model,
            messages,
            temperature: 0,
            response_format: { type: 'json_schema', json_schema: { name, schema, strict: true } },
          },
          { signal },
        );
        const content = response.choices[0]?.message.content;
        if (!content) throw new Error('empty response');
        return content;
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new RetryableError(`Model call failed: ${String(error)}`);
      }
    },
  };
}

// OpenAI-compatible client pointed at Ollama; any model error is considered transient
export function createChatModel({ baseUrl, apiKey, model }: Options): ChatModel {
  const client = new OpenAI({ baseURL: baseUrl, apiKey, timeout: LLM_TIMEOUT_MS, maxRetries: 1 });
  return {
    name: model,
    async complete(messages, tools, signal) {
      try {
        const response = await client.chat.completions.create(
          { model, messages, tools, temperature: 0 },
          { signal },
        );
        const message = response.choices[0]?.message;
        if (!message) throw new Error('empty response');
        return message;
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new RetryableError(`Model call failed: ${String(error)}`);
      }
    },
  };
}
