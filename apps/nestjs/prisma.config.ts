import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // `prisma generate` does not need the database: DATABASE_URL may be missing (Docker build)
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
