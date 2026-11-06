import { Injectable } from '@nestjs/common';
import type { HistoryLoadBatch, HistoryLoadResult } from '@fleet/contracts';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Loads the reference data and the history (simulator, `preparing` state). Idempotent:
   * stable ids supplied by the simulator, ON CONFLICT DO NOTHING everywhere.
   * Insertion order compatible with the foreign keys.
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
   * Full reset (spec 01): every simulation starts from an empty database.
   * A single TRUNCATE statement, hence atomic.
   */
  async wipe(): Promise<void> {
    await this.prisma.$executeRawUnsafe(`
      TRUNCATE TABLE investigation_steps, investigations, human_reviews, alerts, tasks,
        telemetry_readings, refuels, driver_messages, driver_assignments,
        drivers, trucks, places, carriers
      RESTART IDENTITY CASCADE`);
  }
}
