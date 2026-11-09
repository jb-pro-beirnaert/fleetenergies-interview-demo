import { Module } from '@nestjs/common';
import { InvoicesModule } from '../invoices/invoices.module.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

@Module({
  imports: [InvoicesModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
