import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { HistoryLoadBatch, HistoryLoadResult } from '@fleet/contracts';
import { RequireToken } from '../auth/require-token.decorator.js';
import { AdminService } from './admin.service.js';

@ApiTags('admin')
@RequireToken('admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Post('history/load')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Load the reference data and the history',
    description: 'Batches sent by the simulator (`preparing` state). Idempotent.',
  })
  @ApiOkResponse({ standardSchema: HistoryLoadResult })
  loadHistory(@Body({ schema: HistoryLoadBatch }) batch: HistoryLoadBatch) {
    return this.admin.loadHistory(batch);
  }

  @Post('wipe')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Wipe the whole database',
    description:
      'Reference data, history, demo day, alerts, investigations and tasks. Called by the simulator on every "Start" and "Reset".',
  })
  @ApiNoContentResponse()
  wipe() {
    return this.admin.wipe();
  }
}
