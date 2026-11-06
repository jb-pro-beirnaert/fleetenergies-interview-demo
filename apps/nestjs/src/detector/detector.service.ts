import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import {
  buildDropDetails,
  DEDUP_WINDOW_MS,
  DETECTION_WINDOW_MS,
  evaluateFuelDrop,
  type RuleReading,
} from './fuel-drop.rule.js';

type Tx = Prisma.TransactionClient;

@Injectable()
export class DetectorService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Applique la règle à chaque nouveau relevé `live` d'un camion, dans l'ordre chronologique.
   * Un verrou consultatif par camion sérialise les lots concurrents (pas d'alerte en double).
   * Retourne le nombre d'alertes créées.
   */
  async processNewReadings(
    truckId: string,
    recordedAts: Date[],
  ): Promise<number> {
    const sorted = [...recordedAts].sort((a, b) => a.getTime() - b.getTime());
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${truckId}))`;
      let created = 0;
      for (const recordedAt of sorted) {
        if (await this.evaluate(tx, truckId, recordedAt)) created++;
      }
      return created;
    });
  }

  private async evaluate(tx: Tx, truckId: string, at: Date): Promise<boolean> {
    const window = await this.readings(
      tx,
      truckId,
      new Date(at.getTime() - DETECTION_WINDOW_MS),
      at,
    );
    const anomaly = evaluateFuelDrop(window, this.config.FUEL_DROP_MIN_L);
    if (!anomaly) return false;

    const existing = await tx.alert.findFirst({
      where: {
        truckId,
        type: 'fuel_drop',
        windowEnd: { gte: new Date(at.getTime() - DEDUP_WINDOW_MS) },
      },
      orderBy: { windowEnd: 'desc' },
    });

    if (existing) {
      // Déjà en enquête : l'agent verra la courbe complète
      if (existing.status !== 'detected') return false;
      const episode = await this.readings(
        tx,
        truckId,
        existing.windowStart,
        at,
      );
      const details = buildDropDetails(episode);
      const dropL = details.levelBeforeL - details.levelAfterL;
      await tx.alert.update({
        where: { id: existing.id },
        data: {
          windowEnd: at > existing.windowEnd ? at : existing.windowEnd,
          dropL: Math.max(dropL, existing.dropL?.toNumber() ?? 0),
          details: { ...(existing.details as object), ...details },
        },
      });
      return false;
    }

    const episode = window.filter(
      (reading) => reading.recordedAt >= anomaly.startAt,
    );
    const alert = await tx.alert.create({
      data: {
        truckId,
        type: 'fuel_drop',
        status: 'detected',
        windowStart: anomaly.startAt,
        windowEnd: anomaly.endAt,
        dropL: anomaly.dropL,
        details: { ...buildDropDetails(episode) },
        detectedAt: new Date(),
      },
    });
    await tx.task.create({
      data: {
        type: 'investigate_alert',
        payload: { alertId: alert.id },
        availableAt: new Date(
          Date.now() + this.config.DETECTOR_DEBOUNCE_SECONDS * 1000,
        ),
      },
    });
    return true;
  }

  private async readings(
    tx: Tx,
    truckId: string,
    from: Date,
    to: Date,
  ): Promise<RuleReading[]> {
    const rows = await tx.telemetryReading.findMany({
      where: { truckId, recordedAt: { gte: from, lte: to } },
      orderBy: { recordedAt: 'asc' },
      select: {
        recordedAt: true,
        speedKmh: true,
        ignition: true,
        fuelLevelL: true,
        lat: true,
        lon: true,
      },
    });
    return rows.map((row) => ({
      ...row,
      speedKmh: row.speedKmh.toNumber(),
      fuelLevelL: row.fuelLevelL.toNumber(),
    }));
  }
}
