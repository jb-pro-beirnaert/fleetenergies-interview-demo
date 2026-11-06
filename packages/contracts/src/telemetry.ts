import { z } from 'zod';
import { DataSource } from './enums.ts';

export const TelemetryReading = z.object({
  truckId: z.uuid(),
  recordedAt: z.iso.datetime({ offset: true }),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  speedKmh: z.number().min(0),
  ignition: z.boolean(),
  fuelLevelL: z.number().min(0),
  odometerKm: z.number().min(0),
});
export type TelemetryReading = z.infer<typeof TelemetryReading>;

export const TelemetryBatch = z
  .object({
    readings: z.array(TelemetryReading).min(1).max(500),
    source: DataSource,
  })
  .meta({ id: 'TelemetryBatch' });
export type TelemetryBatch = z.infer<typeof TelemetryBatch>;

export const TelemetryIngestResult = z
  .object({ inserted: z.int(), alertsCreated: z.int() })
  .meta({ id: 'TelemetryIngestResult' });
export type TelemetryIngestResult = z.infer<typeof TelemetryIngestResult>;

export const FuelCardTransaction = z.object({
  truckId: z.uuid(),
  occurredAt: z.iso.datetime({ offset: true }),
  placeId: z.uuid().nullish(),
  liters: z.number().positive(),
  unitPriceEur: z.number().positive().nullish(),
  totalEur: z.number().positive().nullish(),
});
export type FuelCardTransaction = z.infer<typeof FuelCardTransaction>;

export const FuelCardBatch = z
  .object({
    transactions: z.array(FuelCardTransaction).min(1).max(500),
    source: DataSource,
  })
  .meta({ id: 'FuelCardBatch' });
export type FuelCardBatch = z.infer<typeof FuelCardBatch>;

export const DriverMessageInput = z.object({
  driverId: z.uuid(),
  truckId: z.uuid(),
  sentAt: z.iso.datetime({ offset: true }),
  body: z.string().min(1).max(2000),
});
export type DriverMessageInput = z.infer<typeof DriverMessageInput>;

export const DriverMessageBatch = z
  .object({
    messages: z.array(DriverMessageInput).min(1).max(500),
    source: DataSource,
  })
  .meta({ id: 'DriverMessageBatch' });
export type DriverMessageBatch = z.infer<typeof DriverMessageBatch>;

export const IngestResult = z
  .object({ inserted: z.int() })
  .meta({ id: 'IngestResult' });
export type IngestResult = z.infer<typeof IngestResult>;
