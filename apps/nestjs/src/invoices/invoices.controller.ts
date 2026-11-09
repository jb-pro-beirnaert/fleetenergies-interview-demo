import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  InvoiceDetail,
  InvoiceExtraction,
  InvoiceExtractionOutcome,
  InvoiceList,
  InvoiceListQuery,
  InvoiceText,
  InvoiceUploadFields,
  InvoiceUploadResult,
} from '@fleet/contracts';
import { RequireToken } from '../auth/require-token.decorator.js';
import { PiiInterceptor } from '../pii/pii.interceptor.js';
import { InvoicesService, type UploadedPdf } from './invoices.service.js';

export const INVOICE_MAX_BYTES = 5 * 1024 * 1024;
const PDF_MAGIC = '%PDF-';

// Reception of the invoices sent by the suppliers (the simulator)
@ApiTags('ingestion')
@RequireToken('device')
@Controller('api/invoices')
export class InvoiceIngestionController {
  constructor(private readonly invoices: InvoicesService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: INVOICE_MAX_BYTES, files: 1 } }))
  @ApiOperation({
    summary: 'PDF invoice reception',
    description:
      'Stores the PDF, extracts its text in code (unpdf), detects injections, creates an `extract_invoice` task. ' +
      'Idempotent on the file content. A PDF without text is recorded as `failed`.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'receivedAt'],
      properties: {
        file: { type: 'string', format: 'binary' },
        receivedAt: { type: 'string', format: 'date-time' },
        source: { type: 'string', enum: ['history', 'live'], default: 'live' },
      },
    },
  })
  @ApiOkResponse({ standardSchema: InvoiceUploadResult })
  upload(
    @UploadedFile() file: UploadedPdf | undefined,
    @Body({ schema: InvoiceUploadFields }) fields: InvoiceUploadFields,
  ) {
    if (!file) throw new BadRequestException('Missing `file` field (PDF)');
    if (file.buffer.subarray(0, PDF_MAGIC.length).toString('latin1') !== PDF_MAGIC) {
      throw new BadRequestException('The file is not a PDF');
    }
    return this.invoices.upload(file, fields);
  }
}

// Extractor routes: the text (masked) and the extraction result
@ApiTags('agent · invoices')
@RequireToken('agent')
@UseInterceptors(PiiInterceptor)
@Controller('agent/invoices/:id')
export class InvoiceAgentController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get('text')
  @ApiOperation({ summary: 'Invoice text extracted by code, names, phone numbers and emails masked' })
  @ApiOkResponse({ standardSchema: InvoiceText })
  @ApiNotFoundResponse({ description: 'Invoice not found' })
  @ApiConflictResponse({ description: 'Invoice without text' })
  text(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.text(id);
  }

  @Post('extraction')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record the extraction',
    description:
      'Consistency rules (liters × unit price ≈ total ±2%, liters 1–1,200), otherwise 422. ' +
      '`suspicious` = code OR model. Then reconciliation in code: `matched`, `mismatch` (billing_mismatch alert + investigation task) or `needs_review`. Idempotent.',
  })
  @ApiOkResponse({ standardSchema: InvoiceExtractionOutcome })
  @ApiNotFoundResponse({ description: 'Invoice not found' })
  @ApiUnprocessableEntityResponse({ description: 'Inconsistent extraction' })
  extraction(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: InvoiceExtraction }) extraction: InvoiceExtraction,
  ) {
    return this.invoices.submitExtraction(id, extraction);
  }
}

// Control room (Invoices tab): routes open locally, like the other screen routes
@ApiTags('screen')
@Controller('api/invoices')
export class InvoiceScreenController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @ApiOperation({ summary: 'Invoices, most recent first' })
  @ApiOkResponse({ standardSchema: InvoiceList })
  list(@Query({ schema: InvoiceListQuery }) query: InvoiceListQuery) {
    return this.invoices.list(query.limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Invoice: text, extraction, reconciliation, linked alert' })
  @ApiOkResponse({ standardSchema: InvoiceDetail })
  @ApiNotFoundResponse({ description: 'Invoice not found' })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.detail(id);
  }

  @Get(':id/file')
  @ApiOperation({ summary: 'The received PDF' })
  @ApiProduces('application/pdf')
  @ApiNotFoundResponse({ description: 'Invoice or file not found' })
  async file(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { content, filename } = await this.invoices.file(id);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `inline; filename="${filename.replace(/"/g, '')}"`);
    return new StreamableFile(content);
  }
}
