import { Injectable } from '@nestjs/common';
import type {
  HistoryLoadBatch,
  HistoryLoadResult,
  ResetResult,
} from '@fleet/contracts';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Chargement du référentiel et de l'historique (`simulator load`). Idempotent :
   * identifiants stables fournis par le simulateur, ON CONFLICT DO NOTHING partout.
   * Ordre d'insertion compatible avec les clés étrangères.
   */
  async loadHistory(batch: HistoryLoadBatch): Promise<HistoryLoadResult> {
    return this.prisma.$transaction(async (tx) => {
      const count = async (promise: Promise<{ count: number }>) =>
        (await promise).count;
      const carriers = await count(
        tx.carrier.createMany({
          data: batch.carriers ?? [],
          skipDuplicates: true,
        }),
      );
      const places = await count(
        tx.place.createMany({
          data: (batch.places ?? []).map((place) => ({
            ...place,
            brand: place.brand ?? null,
          })),
          skipDuplicates: true,
        }),
      );
      const trucks = await count(
        tx.truck.createMany({
          data: (batch.trucks ?? []).map((truck) => ({
            ...truck,
            sensorNotes: truck.sensorNotes ?? null,
          })),
          skipDuplicates: true,
        }),
      );
      const drivers = await count(
        tx.driver.createMany({
          data: batch.drivers ?? [],
          skipDuplicates: true,
        }),
      );
      const assignments = await count(
        tx.driverAssignment.createMany({
          data: (batch.assignments ?? []).map((assignment) => ({
            ...assignment,
            startsAt: new Date(assignment.startsAt),
            endsAt: new Date(assignment.endsAt),
          })),
          skipDuplicates: true,
        }),
      );
      const telemetry = await count(
        tx.telemetryReading.createMany({
          data: (batch.telemetry ?? []).map((reading) => ({
            ...reading,
            recordedAt: new Date(reading.recordedAt),
            source: 'history' as const,
          })),
          skipDuplicates: true,
        }),
      );
      const refuels = await count(
        tx.refuel.createMany({
          data: (batch.refuels ?? []).map((refuel) => ({
            truckId: refuel.truckId,
            occurredAt: new Date(refuel.occurredAt),
            placeId: refuel.placeId ?? null,
            liters: refuel.liters,
            unitPriceEur: refuel.unitPriceEur ?? null,
            totalEur: refuel.totalEur ?? null,
            source: 'fuel_card' as const,
            dataOrigin: 'history' as const,
          })),
          skipDuplicates: true,
        }),
      );
      const messages = await count(
        tx.driverMessage.createMany({
          data: (batch.messages ?? []).map((message) => ({
            ...message,
            sentAt: new Date(message.sentAt),
            dataOrigin: 'history' as const,
          })),
          skipDuplicates: true,
        }),
      );
      return {
        inserted: {
          carriers,
          places,
          trucks,
          drivers,
          assignments,
          telemetry,
          refuels,
          messages,
        },
      };
    });
  }

  /**
   * Remise à zéro de la journée de démo : données `live`, puis alertes, enquêtes,
   * étapes, revues et tâches (toutes issues des lots `live`). L'historique est conservé.
   */
  async reset(): Promise<ResetResult> {
    return this.prisma.$transaction(async (tx) => {
      const steps = await tx.investigationStep.deleteMany();
      const investigations = await tx.investigation.deleteMany();
      const reviews = await tx.humanReview.deleteMany();
      const alerts = await tx.alert.deleteMany();
      const tasks = await tx.task.deleteMany();
      const telemetry = await tx.telemetryReading.deleteMany({
        where: { source: 'live' },
      });
      const refuels = await tx.refuel.deleteMany({
        where: { dataOrigin: 'live' },
      });
      const messages = await tx.driverMessage.deleteMany({
        where: { dataOrigin: 'live' },
      });
      return {
        deleted: {
          telemetry: telemetry.count,
          refuels: refuels.count,
          messages: messages.count,
          alerts: alerts.count,
          investigations: investigations.count,
          steps: steps.count,
          reviews: reviews.count,
          tasks: tasks.count,
        },
      };
    });
  }
}
