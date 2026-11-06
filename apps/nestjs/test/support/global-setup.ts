import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { TEST_DATABASE_URL } from '../../vitest.config.e2e.js';

// Checks that the test database answers, then applies the Prisma migrations
export default async function setup() {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `Test database unreachable (${TEST_DATABASE_URL}). Run \`npm run test:db:up\` at the root.\n${String(error)}`,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
}
