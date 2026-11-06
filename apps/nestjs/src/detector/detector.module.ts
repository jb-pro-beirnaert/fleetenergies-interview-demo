import { Module } from '@nestjs/common';
import { DetectorService } from './detector.service.js';

@Module({
  providers: [DetectorService],
  exports: [DetectorService],
})
export class DetectorModule {}
