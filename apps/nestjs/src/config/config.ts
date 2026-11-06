import { z } from 'zod';

export const APP_CONFIG = Symbol('APP_CONFIG');

// Variables d'environnement validées au démarrage (spec 03, module `config`)
export const ConfigSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  DEVICE_TOKEN: z.string().min(1),
  AGENT_API_TOKEN: z.string().min(1),
  ADMIN_TOKEN: z.string().min(1),
  FUEL_DROP_MIN_L: z.coerce.number().positive().default(40),
  DETECTOR_DEBOUNCE_SECONDS: z.coerce.number().min(0).default(15),
  AUTO_CLOSE_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.75),
  // 0 désactive le balayage périodique (tests)
  TASK_SWEEP_INTERVAL_MS: z.coerce.number().int().min(0).default(30_000),
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
