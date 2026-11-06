import { defineConfig } from 'vitest/config';

// Tests d'intégration : base Postgres de docker-compose.test.yaml (`npm run test:db:up`)
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://fleet:fleet@localhost:5433/fleet_test';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    globalSetup: ['./test/support/global-setup.ts'],
    // Une seule base partagée : fichiers exécutés l'un après l'autre
    fileParallelism: false,
    hookTimeout: 30_000,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      DEVICE_TOKEN: 'test-device-token',
      AGENT_API_TOKEN: 'test-agent-token',
      ADMIN_TOKEN: 'test-admin-token',
      FUEL_DROP_MIN_L: '40',
      DETECTOR_DEBOUNCE_SECONDS: '0',
      AUTO_CLOSE_MIN_CONFIDENCE: '0.75',
      TASK_SWEEP_INTERVAL_MS: '0',
    },
  },
});
