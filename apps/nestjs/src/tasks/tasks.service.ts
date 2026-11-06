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
  payload: { alertId: string };
  attempts: number;
}

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  /** Réservation (spec 01) ; `null` si aucune tâche disponible. */
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

      if (task.type === 'investigate_alert') {
        await this.openInvestigation(tx, task.payload.alertId);
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

  /** Balayage : tâches à verrou expiré ayant épuisé leurs tentatives → échec définitif. */
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
          `Verrou expiré après ${task.attempts} tentative(s)`,
        );
      }
      return expired.length;
    });
  }

  private async lockOwned(tx: Tx, id: string, workerId: string): Promise<Task> {
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM tasks WHERE id = ${id}::uuid FOR UPDATE`;
    if (!row) throw new NotFoundException('Tâche introuvable');
    const task = await tx.task.findUniqueOrThrow({ where: { id } });
    if (task.status !== 'in_progress' || task.lockedBy !== workerId) {
      throw new ConflictException(
        'Tâche non réservée par ce worker (verrou expiré ou repris par un autre)',
      );
    }
    return task;
  }

  private async openInvestigation(tx: Tx, alertId: string): Promise<void> {
    await tx.alert.update({
      where: { id: alertId },
      data: { status: 'investigating' },
    });
    // Nouvelle tentative : on réutilise la ligne, les étapes précédentes sont conservées
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
    if (task.type !== 'investigate_alert') return;

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
