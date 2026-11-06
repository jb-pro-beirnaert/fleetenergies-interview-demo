import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  ClaimedTask,
  ClaimRequest,
  CompleteRequest,
  FailRequest,
} from '@fleet/contracts';
import { RequireToken } from '../auth/require-token.decorator.js';
import { TasksService } from './tasks.service.js';

@ApiTags('agent · tâches')
@RequireToken('agent')
@Controller('agent/tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Post('claim')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Réserver une tâche',
    description:
      'FOR UPDATE SKIP LOCKED, verrou de 5 min. Pour `investigate_alert` : alerte → `investigating`, enquête ouverte ou rouverte.',
  })
  @ApiOkResponse({ standardSchema: ClaimedTask })
  @ApiNoContentResponse({ description: 'Aucune tâche disponible' })
  async claim(
    @Body({ schema: ClaimRequest }) request: ClaimRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const task = await this.tasks.claim(request);
    if (!task) response.status(HttpStatus.NO_CONTENT);
    return task ?? undefined;
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Terminer une tâche' })
  @ApiNoContentResponse({ description: 'Tâche terminée' })
  @ApiNotFoundResponse({ description: 'Tâche introuvable' })
  @ApiConflictResponse({
    description: "Le worker n'est pas titulaire du verrou",
  })
  async complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: CompleteRequest }) request: CompleteRequest,
  ) {
    await this.tasks.complete(id, request);
  }

  @Post(':id/fail')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Signaler un échec',
    description:
      'Relançable et tentatives restantes : retour en `pending` (délai 10 s × tentatives). Sinon échec définitif : enquête `failed`, alerte `escalated`.',
  })
  @ApiNoContentResponse({ description: 'Échec enregistré' })
  @ApiNotFoundResponse({ description: 'Tâche introuvable' })
  @ApiConflictResponse({
    description: "Le worker n'est pas titulaire du verrou",
  })
  async fail(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: FailRequest }) request: FailRequest,
  ) {
    await this.tasks.fail(id, request);
  }
}
