import { Module } from '@nestjs/common';
import { InvestigationDataController } from './investigation-data.controller.js';
import { InvestigationDataService } from './investigation-data.service.js';

@Module({
  controllers: [InvestigationDataController],
  providers: [InvestigationDataService],
})
export class InvestigationDataModule {}
