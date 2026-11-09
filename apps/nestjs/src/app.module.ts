import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { InvestigationDataModule } from './investigation-data/investigation-data.module.js';
import { InvestigationsModule } from './investigations/investigations.module.js';
import { InvoicesModule } from './invoices/invoices.module.js';
import { PiiModule } from './pii/pii.module.js';
import { ScreenModule } from './screen/screen.module.js';
import { TasksModule } from './tasks/tasks.module.js';
import { TelemetryModule } from './telemetry/telemetry.module.js';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    PiiModule,
    TelemetryModule,
    TasksModule,
    InvestigationsModule,
    InvestigationDataModule,
    ScreenModule,
    InvoicesModule,
    AdminModule,
  ],
})
export class AppModule {}
