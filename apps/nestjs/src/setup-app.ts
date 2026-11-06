import {
  type INestApplication,
  StandardSchemaValidationPipe,
} from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { PrismaExceptionFilter } from './database/prisma-exception.filter.js';

export const DOCS_PATH = 'docs';

// Configuration shared by main.ts and the integration tests
export function setupApp(app: INestApplication) {
  // Validates every parameter declared with `{ schema }` (Zod schemas from @fleet/contracts)
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.useGlobalFilters(new PrismaExceptionFilter());
  app.enableShutdownHooks();

  const config = new DocumentBuilder()
    .setTitle('Fleet Copilot API')
    .setDescription(
      'Control centre: ingestion, detector, task queue, investigations, agent and screen routes. Code detects and computes, AI investigates and explains, the human decides.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', description: 'DEVICE_TOKEN' },
      'device',
    )
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', description: 'AGENT_API_TOKEN' },
      'agent',
    )
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', description: 'ADMIN_TOKEN' },
      'admin',
    )
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(DOCS_PATH, app, documentFactory, {
    jsonDocumentUrl: `${DOCS_PATH}/json`,
    yamlDocumentUrl: `${DOCS_PATH}/yaml`,
  });
}
