import { Injectable } from '@nestjs/common';
import type {
  DriverMessageBatch,
  FuelCardBatch,
  IngestResult,
  TelemetryBatch,
  TelemetryIngestResult,
} from '@fleet/contracts';
import { PrismaService } from '../database/prisma.service.js';
import { DetectorService } from '../detector/detector.service.js';

@Injectable()
export class TelemetryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly detector: DetectorService,
  ) {}

  // Idempotent: ON CONFLICT (truck_id, recorded_at) DO NOTHING; detection on `live` batches only
  async ingestTelemetry(batch: TelemetryBatch): Promise<TelemetryIngestResult> {
    const inserted = await this.prisma.telemetryReading.createManyAndReturn({
      data: batch.readings.map((reading) => ({
        truckId: reading.truckId,
        recordedAt: new Date(reading.recordedAt),
        lat: reading.lat,
        lon: reading.lon,
        speedKmh: reading.speedKmh,
        ignition: reading.ignition,
        fuelLevelL: reading.fuelLevelL,
        odometerKm: reading.odometerKm,
        source: batch.source,
      })),
      skipDuplicates: true,
      select: { truckId: true, recordedAt: true },
    });

    let alertsCreated = 0;
    if (batch.source === 'live') {
      const byTruck = Map.groupBy(inserted, (row) => row.truckId);
      for (const [truckId, rows] of byTruck) {
        alertsCreated += await this.detector.processNewReadings(
          truckId,
          rows.map((row) => row.recordedAt),
        );
      }
    }
    return { inserted: inserted.length, alertsCreated };
  }

  // Idempotent on (truck_id, occurred_at)
  async ingestFuelCards(batch: FuelCardBatch): Promise<IngestResult> {
    const { count } = await this.prisma.refuel.createMany({
      data: batch.transactions.map((transaction) => ({
        truckId: transaction.truckId,
        occurredAt: new Date(transaction.occurredAt),
        placeId: transaction.placeId ?? null,
        liters: transaction.liters,
        unitPriceEur: transaction.unitPriceEur ?? null,
        totalEur: transaction.totalEur ?? null,
        source: 'fuel_card',
        dataOrigin: batch.source,
      })),
      skipDuplicates: true,
    });
    return { inserted: count };
  }

  // Idempotent on (driver_id, sent_at)
  async ingestDriverMessages(batch: DriverMessageBatch): Promise<IngestResult> {
    const { count } = await this.prisma.driverMessage.createMany({
      data: batch.messages.map((message) => ({
        driverId: message.driverId,
        truckId: message.truckId,
        sentAt: new Date(message.sentAt),
        body: message.body,
        dataOrigin: batch.source,
      })),
      skipDuplicates: true,
    });
    return { inserted: count };
  }
}
