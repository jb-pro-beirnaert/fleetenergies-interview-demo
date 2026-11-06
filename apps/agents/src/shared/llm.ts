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

type Options = { baseUrl: string; apiKey: string; model: string };

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
