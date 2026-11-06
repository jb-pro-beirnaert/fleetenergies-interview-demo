import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import {
  AlertContext,
  StepInput,
  StepInputResult,
  VerdictOutcome,
  VerdictSubmission,
} from '@fleet/contracts';
import { RequireToken } from '../auth/require-token.decorator.js';
import { PiiInterceptor } from '../pii/pii.interceptor.js';
import { InvestigationsService } from './investigations.service.js';

@ApiTags('agent · enquêtes')
@RequireToken('agent')
@UseInterceptors(PiiInterceptor)
@ApiNotFoundResponse({ description: 'Alerte ou enquête introuvable' })
@Controller('agent')
export class InvestigationsController {
  constructor(private readonly investigations: InvestigationsService) {}

  @Get('alerts/:id')
  @ApiOperation({ summary: "Contexte d'une alerte (sans donnée personnelle)" })
  @ApiOkResponse({ standardSchema: AlertContext })
  context(@Param('id', ParseUUIDPipe) id: string) {
    return this.investigations.context(id);
  }

  @Post('investigations/:alertId/steps')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Enregistrer une étape d'enquête",
    description: 'Idempotent sur (enquête, tentative, seq).',
  })
  @ApiOkResponse({ standardSchema: StepInputResult })
  addStep(
    @Param('alertId', ParseUUIDPipe) alertId: string,
    @Body({ schema: StepInput }) step: StepInput,
  ) {
    return this.investigations.addStep(alertId, step);
  }

  @Post('investigations/:alertId/verdict')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Soumettre le verdict',
    description:
      "Vérifie les preuves contre les étapes `tool_call` de la tentative en cours, puis l'API décide : `theft_suspected`, `billing_discrepancy`, `inconclusive` → escalade ; sinon clôture si confiance ≥ seuil. Idempotent.",
  })
  @ApiOkResponse({ standardSchema: VerdictOutcome })
  @ApiUnprocessableEntityResponse({
    description: 'Preuve citant un `toolCallId` inconnu (`unknownToolCallIds`)',
  })
  @ApiConflictResponse({ description: 'Enquête en échec définitif' })
  submitVerdict(
    @Param('alertId', ParseUUIDPipe) alertId: string,
    @Body({ schema: VerdictSubmission }) submission: VerdictSubmission,
  ) {
    return this.investigations.submitVerdict(alertId, submission);
  }
}
