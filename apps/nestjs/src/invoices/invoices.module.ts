import { Module } from '@nestjs/common';
import {
  InvoiceAgentController,
  InvoiceIngestionController,
  InvoiceScreenController,
} from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';
import { InvoiceStorage } from './invoice-storage.service.js';

// V2: reception, text, extraction, reconciliation (spec 03)
@Module({
  controllers: [InvoiceIngestionController, InvoiceAgentController, InvoiceScreenController],
  providers: [InvoicesService, InvoiceStorage],
  exports: [InvoiceStorage],
})
export class InvoicesModule {}
