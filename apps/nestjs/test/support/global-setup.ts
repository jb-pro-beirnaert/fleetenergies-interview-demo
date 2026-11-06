import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { TEST_DATABASE_URL } from '../../vitest.config.e2e.js';

// Vérifie que la base de test répond, puis applique les migrations Prisma
export default async function setup() {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `Base de test injoignable (${TEST_DATABASE_URL}). Lancer \`npm run test:db:up\` à la racine.\n${String(error)}`,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
}
