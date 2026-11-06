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

@ApiTags('agent · tasks')
@RequireToken('agent')
@Controller('agent/tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Post('claim')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Claim a task',
    description:
      'FOR UPDATE SKIP LOCKED, 5-min lock. For `investigate_alert`: alert → `investigating`, investigation opened or reopened.',
  })
  @ApiOkResponse({ standardSchema: ClaimedTask })
  @ApiNoContentResponse({ description: 'No task available' })
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
  @ApiOperation({ summary: 'Complete a task' })
  @ApiNoContentResponse({ description: 'Task completed' })
  @ApiNotFoundResponse({ description: 'Task not found' })
  @ApiConflictResponse({
    description: 'The worker does not hold the lock',
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
    summary: 'Report a failure',
    description:
      'Retryable with attempts left: back to `pending` (delay 10 s × attempts). Otherwise permanent failure: investigation `failed`, alert `escalated`.',
  })
  @ApiNoContentResponse({ description: 'Failure recorded' })
  @ApiNotFoundResponse({ description: 'Task not found' })
  @ApiConflictResponse({
    description: 'The worker does not hold the lock',
  })
  async fail(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: FailRequest }) request: FailRequest,
  ) {
    await this.tasks.fail(id, request);
  }
}
