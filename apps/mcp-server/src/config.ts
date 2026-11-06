import { z } from 'zod';

export const ConfigSchema = z.object({
  MCP_PORT: z.coerce.number().int().positive().default(3100),
  API_URL: z.url(),
  AGENT_API_TOKEN: z.string().min(1),
  MCP_CLIENT_TOKEN: z.string().min(1),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Configuration invalide : ${issues}`);
  }
  return result.data;
}
