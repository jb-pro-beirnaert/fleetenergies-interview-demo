import {
  type INestApplication,
  StandardSchemaValidationPipe,
} from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { PrismaExceptionFilter } from './database/prisma-exception.filter.js';

export const DOCS_PATH = 'docs';

// Configuration commune à main.ts et aux tests d'intégration
export function setupApp(app: INestApplication) {
  // Valide chaque paramètre déclaré avec `{ schema }` (schémas Zod de @fleet/contracts)
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.useGlobalFilters(new PrismaExceptionFilter());
  app.enableShutdownHooks();

  const config = new DocumentBuilder()
    .setTitle('Fleet Copilot API')
    .setDescription(
      "Centre de contrôle : ingestion, détecteur, file de tâches, enquêtes, routes agents et écran. Le code détecte et calcule, l'IA enquête et explique, l'humain décide.",
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
