import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadConfig } from './config/config.js';
import { setupApp } from './setup-app.js';

async function bootstrap() {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule);
  setupApp(app);
  await app.listen(config.PORT);
}
await bootstrap();
