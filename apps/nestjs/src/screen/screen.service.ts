import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AlertDetail,
  AlertListItem,
  AlertListQuery,
  PlaceView,
  Positions,
  ReviewRequest,
  ReviewResult,
  Stats,
  TankCurvePoints,
  Verdict,
} from '@fleet/contracts';
import { PrismaService } from '../database/prisma.service.js';
import { iso, toNum } from '../common/serialize.js';

export interface Window {
  from: Date;
  to: Date;
}

// An alert can only be reviewed once the API has decided
const REVIEWABLE = new Set(['escalated', 'closed']);

@Injectable()
export class ScreenService {
  constructor(private readonly prisma: PrismaService) {}

  async listAlerts(query: AlertListQuery): Promise<AlertListItem[]> {
    const alerts = await this.prisma.alert.findMany({
      where: query.status ? { status: query.status } : {},
      orderBy: { detectedAt: 'desc' },
      take: query.limit,
      include: {
        truck: { select: { plate: true, carrier: { select: { name: true } } } },
        investigation: {
          select: { category: true, confidence: true, toolCallsCount: true },
        },
      },
    });
    return alerts.map((alert) => ({
      id: alert.id,
      type: alert.type,
      status: alert.status,
      decision: alert.decision,
      plate: alert.truck.plate,
      carrier: alert.truck.carrier.name,
      detectedAt: iso(alert.detectedAt),
      windowStart: iso(alert.windowStart),
      windowEnd: iso(alert.windowEnd),
      dropL: toNum(alert.dropL),
      category: alert.investigation?.category ?? null,
      confidence: toNum(alert.investigation?.confidence ?? null),
      toolCallsCount: alert.investigation?.toolCallsCount ?? null,
    }));
  }

  async alertDetail(id: string): Promise<AlertDetail> {
    const alert = await this.prisma.alert.findUnique({
      where: { id },
      include: {
        truck: { include: { carrier: { select: { name: true } } } },
        investigation: {
          include: { steps: { orderBy: [{ attempt: 'asc' }, { seq: 'asc' }] } },
        },
        review: true,
      },
    });
    if (!alert) throw new NotFoundException('Alert not found');
    const { truck, investigation, review } = alert;

    return {
      id: alert.id,
      type: alert.type,
      status: alert.status,
      decision: alert.decision,
      windowStart: iso(alert.windowStart),
      windowEnd: iso(alert.windowEnd),
      dropL: toNum(alert.dropL),
      details: alert.details as Record<string, unknown>,
      detectedAt: iso(alert.detectedAt),
      truck: {
        id: truck.id,
        plate: truck.plate,
        make: truck.make,
        model: truck.model,
        carrier: truck.carrier.name,
        hasReefer: truck.hasReefer,
        tankCapacityL: truck.tankCapacityL,
      },
      investigation: investigation && {
        id: investigation.id,
        status: investigation.status,
        model: investigation.model,
        promptVersion: investigation.promptVersion,
        startedAt: iso(investigation.startedAt),
        finishedAt: iso(investigation.finishedAt),
        durationSeconds:
          investigation.startedAt && investigation.finishedAt
            ? (investigation.finishedAt.getTime() -
                investigation.startedAt.getTime()) /
              1000
            : null,
        category: investigation.category,
        confidence: toNum(investigation.confidence),
        summary: investigation.summary,
        verdict: investigation.verdict as Verdict | null,
        toolCallsCount: investigation.toolCallsCount,
        steps: investigation.steps.map((step) => ({
          id: step.id,
          attempt: step.attempt,
          seq: step.seq,
          kind: step.kind,
          toolName: step.toolName,
          toolCallId: step.toolCallId,
          payload: step.payload,
          durationMs: step.durationMs,
          createdAt: iso(step.createdAt),
        })),
      },
      review: review && {
        decision: review.decision,
        comment: review.comment,
        reviewedAt: iso(review.reviewedAt),
      },
    };
  }

  async tankCurve(truckId: string, window: Window): Promise<TankCurvePoints> {
    const readings = await this.readings(truckId, window);
    return readings.map((reading) => ({
      at: iso(reading.recordedAt),
      levelL: toNum(reading.fuelLevelL),
      speedKmh: toNum(reading.speedKmh),
      ignition: reading.ignition,
    }));
  }

  async positions(truckId: string, window: Window): Promise<Positions> {
    const readings = await this.readings(truckId, window);
    return readings.map((reading) => ({
      at: iso(reading.recordedAt),
      lat: reading.lat,
      lon: reading.lon,
      speedKmh: toNum(reading.speedKmh),
      ignition: reading.ignition,
    }));
  }

  async places(): Promise<PlaceView[]> {
    return this.prisma.place.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        type: true,
        brand: true,
        lat: true,
        lon: true,
        radiusM: true,
      },
    });
  }

  async review(alertId: string, request: ReviewRequest): Promise<ReviewResult> {
    return this.prisma.$transaction(async (tx) => {
      const alert = await tx.alert.findUnique({
        where: { id: alertId },
        include: { review: { select: { id: true } } },
      });
      if (!alert) throw new NotFoundException('Alert not found');
      if (alert.review) throw new ConflictException('Alert already reviewed');
      if (!REVIEWABLE.has(alert.status)) {
        throw new ConflictException(
          `Review only possible for an escalated or closed alert (status: ${alert.status})`,
        );
      }
      const status = request.decision === 'confirm' ? 'confirmed' : 'dismissed';
      await tx.humanReview.create({
        data: {
          alertId,
          decision: request.decision,
          comment: request.comment ?? null,
        },
      });
      await tx.alert.update({ where: { id: alertId }, data: { status } });
      return { alertId, status };
    });
  }

  async stats(): Promise<Stats> {
    const [
      byStatus,
      autoClosed,
      escalated,
      pending,
      completed,
      failed,
      reviews,
      latest,
      lastLive,
    ] = await Promise.all([
      this.prisma.alert.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.alert.count({ where: { decision: 'auto_closed' } }),
      this.prisma.alert.count({ where: { decision: 'escalated' } }),
      this.prisma.alert.count({
        where: { status: { in: ['detected', 'investigating'] } },
      }),
      this.prisma.investigation.findMany({
        where: {
          status: 'completed',
          startedAt: { not: null },
          finishedAt: { not: null },
        },
        select: { startedAt: true, finishedAt: true, toolCallsCount: true },
      }),
      this.prisma.investigation.count({ where: { status: 'failed' } }),
      this.prisma.humanReview.groupBy({
        by: ['decision'],
        _count: { _all: true },
      }),
      this.prisma.investigation.findFirst({
        where: { model: { not: null } },
        orderBy: { finishedAt: { sort: 'desc', nulls: 'last' } },
        select: { model: true },
      }),
      this.prisma.telemetryReading.findFirst({
        where: { source: 'live' },
        orderBy: { recordedAt: 'desc' },
        select: { recordedAt: true },
      }),
    ]);

    const total = byStatus.reduce((sum, row) => sum + row._count._all, 0);
    const average = (values: number[]) =>
      values.length === 0
        ? null
        : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) /
          10;
    const reviewed = reviews.reduce((sum, row) => sum + row._count._all, 0);

    return {
      alerts: {
        total,
        byStatus: Object.fromEntries(
          byStatus.map((row) => [row.status, row._count._all]),
        ),
      },
      ruleOnly: { toReviewManually: total },
      withAgents: { autoClosed, escalated, pending },
      investigations: {
        avgDurationSeconds: average(
          completed.map(
            (inv) =>
              (inv.finishedAt!.getTime() - inv.startedAt!.getTime()) / 1000,
          ),
        ),
        avgToolCalls: average(completed.map((inv) => inv.toolCallsCount)),
        failed,
      },
      humanAgreement: {
        reviewed,
        agreed:
          reviews.find((row) => row.decision === 'confirm')?._count._all ?? 0,
      },
      model: latest?.model ?? null,
      simulatedNow: lastLive ? iso(lastLive.recordedAt) : null,
    };
  }

  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' as const, database: 'ok' as const };
  }

  private async readings(truckId: string, window: Window) {
    const truck = await this.prisma.truck.findUnique({
      where: { id: truckId },
      select: { id: true },
    });
    if (!truck) throw new NotFoundException('Truck not found');
    return this.prisma.telemetryReading.findMany({
      where: { truckId, recordedAt: { gte: window.from, lte: window.to } },
      orderBy: { recordedAt: 'asc' },
    });
  }
}
