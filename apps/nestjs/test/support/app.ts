import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { setupApp } from '../../src/setup-app.js';

export const TOKENS = {
  device: 'test-device-token',
  agent: 'test-agent-token',
  admin: 'test-admin-token',
} as const;

export const auth = (role: keyof typeof TOKENS) => ({
  Authorization: `Bearer ${TOKENS[role]}`,
});

export interface TestApp {
  app: INestApplication<App>;
  prisma: PrismaService;
  http: () => ReturnType<typeof request>;
}

export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  setupApp(app);
  await app.init();
  return {
    app,
    prisma: app.get(PrismaService),
    http: () => request(app.getHttpServer()),
  };
}

export async function resetDatabase(prisma: PrismaService) {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE investigation_steps, investigations, human_reviews, alerts, tasks,
      telemetry_readings, refuels, driver_messages, driver_assignments,
      drivers, trucks, places, carriers
    RESTART IDENTITY CASCADE`);
}
