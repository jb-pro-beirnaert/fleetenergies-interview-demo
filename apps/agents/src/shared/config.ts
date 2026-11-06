import { z } from 'zod';

export const ConfigSchema = z.object({
  API_URL: z.url(),
  AGENT_API_TOKEN: z.string().min(1),
  MCP_URL: z.url(),
  MCP_CLIENT_TOKEN: z.string().min(1),
  LLM_BASE_URL: z.url(),
  LLM_API_KEY: z.string().min(1).default('ollama'),
  LLM_MODEL: z.string().min(1),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  MAX_TOOL_CALLS: z.coerce.number().int().positive().default(10),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return result.data;
}
