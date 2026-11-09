import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ClaimedTask,
  ClaimRequest,
  CompleteRequest,
  FailRequest,
  TaskType,
} from '@fleet/contracts';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma, Task } from '../generated/prisma/client.js';

type Tx = Prisma.TransactionClient;

export const RETRY_DELAY_MS_PER_ATTEMPT = 10_000;

interface ClaimedRow {
  id: string;
  type: TaskType;
  payload: { alertId: string } | { invoiceId: string };
  attempts: number;
}

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  /** Claim (spec 01); `null` if no task is available. */
  async claim({ type, workerId }: ClaimRequest): Promise<ClaimedTask | null> {
    return this.prisma.$transaction(async (tx) => {
      const [task] = await tx.$queryRaw<ClaimedRow[]>`
        UPDATE tasks
        SET status = 'in_progress', attempts = attempts + 1,
            locked_until = now() + interval '5 minutes', locked_by = ${workerId},
            updated_at = now()
        WHERE id = (
          SELECT id FROM tasks
          WHERE type = ${type}::task_type
            AND available_at <= now()
            AND (status = 'pending' OR (status = 'in_progress' AND locked_until < now()))
            AND attempts < max_attempts
          ORDER BY created_at
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, type::text AS type, payload, attempts`;
      if (!task) return null;

      if ('alertId' in task.payload) {
        await this.openInvestigation(tx, task.payload.alertId);
      } else {
        // V2: the invoice is being extracted
        await tx.invoice.updateMany({
          where: { id: task.payload.invoiceId, status: 'received' },
          data: { status: 'extracting' },
        });
      }
      return {
        id: task.id,
        type: task.type,
        payload: task.payload,
        attempts: task.attempts,
      };
    });
  }

  async complete(id: string, { workerId }: CompleteRequest): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockOwned(tx, id, workerId);
      await tx.task.update({
        where: { id },
        data: { status: 'done', lockedUntil: null },
      });
    });
  }

  async fail(id: string, request: FailRequest): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const task = await this.lockOwned(tx, id, request.workerId);
      if (request.retryable && task.attempts < task.maxAttempts) {
        await tx.task.update({
          where: { id },
          data: {
            status: 'pending',
            availableAt: new Date(
              Date.now() + RETRY_DELAY_MS_PER_ATTEMPT * task.attempts,
            ),
            lockedUntil: null,
            lockedBy: null,
            lastError: request.error,
          },
        });
        return;
      }
      await this.failDefinitively(tx, task, request.error);
    });
  }

  /** Sweep: tasks with an expired lock that used up their attempts → permanent failure. */
  async sweep(): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const expired = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM tasks
        WHERE status = 'in_progress' AND locked_until < now()
          AND attempts >= max_attempts
        FOR UPDATE SKIP LOCKED`;
      for (const { id } of expired) {
        const task = await tx.task.findUniqueOrThrow({ where: { id } });
        await this.failDefinitively(
          tx,
          task,
          `Lock expired after ${task.attempts} attempt(s)`,
        );
      }
      return expired.length;
    });
  }

  private async lockOwned(tx: Tx, id: string, workerId: string): Promise<Task> {
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM tasks WHERE id = ${id}::uuid FOR UPDATE`;
    if (!row) throw new NotFoundException('Task not found');
    const task = await tx.task.findUniqueOrThrow({ where: { id } });
    if (task.status !== 'in_progress' || task.lockedBy !== workerId) {
      throw new ConflictException(
        'Task not claimed by this worker (lock expired or taken over by another one)',
      );
    }
    return task;
  }

  private async openInvestigation(tx: Tx, alertId: string): Promise<void> {
    await tx.alert.update({
      where: { id: alertId },
      data: { status: 'investigating' },
    });
    // New attempt: the row is reused, the previous steps are kept
    await tx.investigation.upsert({
      where: { alertId },
      create: { alertId, status: 'running', startedAt: new Date() },
      update: { status: 'running', finishedAt: null },
    });
  }

  private async failDefinitively(tx: Tx, task: Task, error: string) {
    await tx.task.update({
      where: { id: task.id },
      data: {
        status: 'failed',
        lockedUntil: null,
        lockedBy: null,
        lastError: error,
      },
    });
    if (task.type === 'extract_invoice') {
      // V2: extraction impossible → a human reviews the invoice
      const { invoiceId } = task.payload as { invoiceId: string };
      await tx.invoice.updateMany({
        where: { id: invoiceId, status: { in: ['received', 'extracting'] } },
        data: {
          status: 'needs_review',
          matchDetails: {
            truckId: null, plate: null, refuelAt: null, billedL: null, observedRiseL: null,
            gapL: null, toleranceL: null, stationMatched: false, stationName: null,
            refuelId: null, refuelSource: null,
            reason: `Extraction failed: ${error}`.slice(0, 500),
          },
        },
      });
      return;
    }

    const { alertId } = task.payload as { alertId: string };
    await tx.investigation.updateMany({
      where: { alertId },
      data: { status: 'failed', finishedAt: new Date() },
    });
    const alert = await tx.alert.findUnique({ where: { id: alertId } });
    if (!alert) return;
    await tx.alert.update({
      where: { id: alertId },
      data: {
        status: 'escalated',
        decision: 'escalated',
        details: {
          ...(alert.details as object),
          failure: {
            error,
            attempts: task.attempts,
            at: new Date().toISOString(),
          },
        },
      },
    });
  }
}
