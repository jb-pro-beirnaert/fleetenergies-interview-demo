import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  AlertContext,
  StepInput,
  StepInputResult,
  VerdictOutcome,
  VerdictSubmission,
} from '@fleet/contracts';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { iso, toNum } from '../common/serialize.js';
import { decide, statusForDecision } from './decision.js';

@Injectable()
export class InvestigationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async context(alertId: string): Promise<AlertContext> {
    const alert = await this.prisma.alert.findUnique({
      where: { id: alertId },
      include: { truck: { select: { plate: true } } },
    });
    if (!alert) throw new NotFoundException('Alert not found');
    return {
      alertId: alert.id,
      type: alert.type,
      truckId: alert.truckId,
      plate: alert.truck.plate,
      windowStart: iso(alert.windowStart),
      windowEnd: iso(alert.windowEnd),
      dropL: toNum(alert.dropL),
      details: alert.details as Record<string, unknown>,
      detectedAt: iso(alert.detectedAt),
    };
  }

  // Idempotent on (investigation, attempt, seq)
  async addStep(alertId: string, step: StepInput): Promise<StepInputResult> {
    const investigation = await this.findInvestigation(alertId);
    const { count } = await this.prisma.investigationStep.createMany({
      data: {
        investigationId: investigation.id,
        attempt: step.attempt,
        seq: step.seq,
        kind: step.kind,
        toolName: step.toolName ?? null,
        toolCallId: step.toolCallId ?? null,
        payload: (step.payload ?? null) as Prisma.InputJsonValue,
        durationMs: step.durationMs ?? null,
      },
      skipDuplicates: true,
    });
    return { created: count > 0 };
  }

  async submitVerdict(
    alertId: string,
    submission: VerdictSubmission,
  ): Promise<VerdictOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM investigations WHERE alert_id = ${alertId}::uuid FOR UPDATE`;
      if (!locked) throw new NotFoundException('Investigation not found');
      const investigation = await tx.investigation.findUniqueOrThrow({
        where: { id: locked.id },
        include: { alert: true },
      });

      if (investigation.status === 'completed') {
        return {
          alertId,
          alertStatus: investigation.alert.status,
          decision: investigation.alert.decision,
          alreadyCompleted: true,
        };
      }
      if (investigation.status === 'failed') {
        throw new ConflictException('Investigation permanently failed');
      }

      // The evidence must cite tool calls of the current attempt
      const attempt = await this.currentAttempt(tx, alertId);
      const toolCalls = await tx.investigationStep.findMany({
        where: {
          investigationId: investigation.id,
          attempt,
          kind: 'tool_call',
        },
        select: { toolCallId: true },
      });
      const known = new Set(toolCalls.map((step) => step.toolCallId));
      const unknownToolCallIds = submission.verdict.evidence
        .map((evidence) => evidence.toolCallId)
        .filter((id) => !known.has(id));
      if (unknownToolCallIds.length > 0) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          message: `Evidence citing tool calls that do not exist in attempt ${attempt}`,
          unknownToolCallIds,
        });
      }

      const { verdict } = submission;
      const decision = decide(
        verdict.category,
        verdict.confidence,
        this.config.AUTO_CLOSE_MIN_CONFIDENCE,
        investigation.alert.type,
      );
      const alertStatus = statusForDecision(decision);

      await tx.investigation.update({
        where: { id: investigation.id },
        data: {
          status: 'completed',
          finishedAt: new Date(),
          model: submission.model,
          promptVersion: submission.promptVersion,
          toolCallsCount: submission.toolCallsCount,
          category: verdict.category,
          confidence: verdict.confidence,
          summary: verdict.summary,
          verdict: verdict as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.alert.update({
        where: { id: alertId },
        data: { status: alertStatus, decision },
      });
      return { alertId, alertStatus, decision, alreadyCompleted: false };
    });
  }

  private async findInvestigation(alertId: string) {
    const investigation = await this.prisma.investigation.findUnique({
      where: { alertId },
    });
    if (!investigation) throw new NotFoundException('Investigation not found');
    return investigation;
  }

  // Current attempt = number of claims of the alert's investigation task
  private async currentAttempt(
    tx: Prisma.TransactionClient,
    alertId: string,
  ): Promise<number> {
    const task = await tx.task.findFirst({
      where: {
        type: 'investigate_alert',
        payload: { path: ['alertId'], equals: alertId },
      },
      orderBy: { createdAt: 'desc' },
      select: { attempts: true },
    });
    return Math.max(task?.attempts ?? 1, 1);
  }
}
