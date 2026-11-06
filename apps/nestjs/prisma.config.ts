import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // `prisma generate` n'a pas besoin de la base : DATABASE_URL peut être absente (build Docker)
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
