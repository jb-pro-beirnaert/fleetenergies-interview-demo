import { Module } from '@nestjs/common';
import { DetectorModule } from '../detector/detector.module.js';
import { TelemetryController } from './telemetry.controller.js';
import { TelemetryService } from './telemetry.service.js';

@Module({
  imports: [DetectorModule],
  controllers: [TelemetryController],
  providers: [TelemetryService],
})
export class TelemetryModule {}
