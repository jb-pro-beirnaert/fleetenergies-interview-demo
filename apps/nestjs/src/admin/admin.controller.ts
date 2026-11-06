import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HistoryLoadBatch,
  HistoryLoadResult,
  ResetResult,
} from '@fleet/contracts';
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
    summary: "Charger le référentiel et l'historique",
    description: 'Lots envoyés par `simulator load`. Idempotent.',
  })
  @ApiOkResponse({ standardSchema: HistoryLoadResult })
  loadHistory(@Body({ schema: HistoryLoadBatch }) batch: HistoryLoadBatch) {
    return this.admin.loadHistory(batch);
  }

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remettre à zéro la journée de démo',
    description:
      "Supprime les données `live` et tout ce qui en découle ; l'historique est conservé.",
  })
  @ApiOkResponse({ standardSchema: ResetResult })
  reset() {
    return this.admin.reset();
  }
}
