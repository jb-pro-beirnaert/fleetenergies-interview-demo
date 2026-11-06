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
    summary: "Charger le référentiel et l'historique",
    description: 'Lots envoyés par le simulateur (état `preparing`). Idempotent.',
  })
  @ApiOkResponse({ standardSchema: HistoryLoadResult })
  loadHistory(@Body({ schema: HistoryLoadBatch }) batch: HistoryLoadBatch) {
    return this.admin.loadHistory(batch);
  }

  @Post('wipe')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Vider toute la base',
    description:
      'Référentiel, historique, journée de démo, alertes, enquêtes et tâches. Appelé par le simulateur à chaque « Démarrer » et « Reset ».',
  })
  @ApiNoContentResponse()
  wipe() {
    return this.admin.wipe();
  }
}
