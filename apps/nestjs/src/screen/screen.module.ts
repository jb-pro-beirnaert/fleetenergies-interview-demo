import { Module } from '@nestjs/common';
import { ScreenController } from './screen.controller.js';
import { ScreenService } from './screen.service.js';

@Module({
  controllers: [ScreenController],
  providers: [ScreenService],
})
export class ScreenModule {}
