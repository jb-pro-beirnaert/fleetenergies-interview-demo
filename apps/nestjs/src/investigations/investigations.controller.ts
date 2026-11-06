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

@ApiTags('agent · investigations')
@RequireToken('agent')
@UseInterceptors(PiiInterceptor)
@ApiNotFoundResponse({ description: 'Alert or investigation not found' })
@Controller('agent')
export class InvestigationsController {
  constructor(private readonly investigations: InvestigationsService) {}

  @Get('alerts/:id')
  @ApiOperation({ summary: 'Alert context (no personal data)' })
  @ApiOkResponse({ standardSchema: AlertContext })
  context(@Param('id', ParseUUIDPipe) id: string) {
    return this.investigations.context(id);
  }

  @Post('investigations/:alertId/steps')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record an investigation step',
    description: 'Idempotent on (investigation, attempt, seq).',
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
    summary: 'Submit the verdict',
    description:
      'Checks the evidence against the `tool_call` steps of the current attempt, then the API decides: `theft_suspected`, `billing_discrepancy`, `inconclusive` → escalation; otherwise closed if confidence ≥ threshold. Idempotent.',
  })
  @ApiOkResponse({ standardSchema: VerdictOutcome })
  @ApiUnprocessableEntityResponse({
    description: 'Evidence citing an unknown `toolCallId` (`unknownToolCallIds`)',
  })
  @ApiConflictResponse({ description: 'Investigation permanently failed' })
  submitVerdict(
    @Param('alertId', ParseUUIDPipe) alertId: string,
    @Body({ schema: VerdictSubmission }) submission: VerdictSubmission,
  ) {
    return this.investigations.submitVerdict(alertId, submission);
  }
}
