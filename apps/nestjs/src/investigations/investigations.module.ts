import { Module } from '@nestjs/common';
import { InvestigationsController } from './investigations.controller.js';
import { InvestigationsService } from './investigations.service.js';

@Module({
  controllers: [InvestigationsController],
  providers: [InvestigationsService],
})
export class InvestigationsModule {}
