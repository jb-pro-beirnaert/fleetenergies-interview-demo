import { z } from 'zod';
import { Energy, PlaceType } from './enums.ts';
import {
  DriverMessageInput,
  FuelCardTransaction,
  TelemetryReading,
} from './telemetry.ts';

// Référentiel (identifiants fournis par le simulateur : UUID v5 stables)
export const CarrierInput = z.object({
  id: z.uuid(),
  name: z.string().min(1),
});
export type CarrierInput = z.infer<typeof CarrierInput>;

export const PlaceInput = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  type: PlaceType,
  brand: z.string().nullish(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  radiusM: z.int().positive().optional(),
});
export type PlaceInput = z.infer<typeof PlaceInput>;

export const TruckInputRef = z.object({
  id: z.uuid(),
  carrierId: z.uuid(),
  plate: z.string().regex(/^[A-Z]{2}-\d{3}-[A-Z]{2}$/),
  make: z.string().min(1),
  model: z.string().min(1),
  energy: Energy,
  tankCapacityL: z.int().min(1),
  hasReefer: z.boolean(),
  baselineLPer100km: z.number().positive(),
  idleLPerHour: z.number().min(0),
  homeDepotId: z.uuid(),
  sensorNotes: z.string().nullish(),
});
export type TruckInputRef = z.infer<typeof TruckInputRef>;

export const DriverInput = z.object({
  id: z.uuid(),
  carrierId: z.uuid(),
  fullName: z.string().min(1),
  phone: z.string().min(1),
  pseudonym: z.string().regex(/^C-\d{2,}$/),
});
export type DriverInput = z.infer<typeof DriverInput>;

export const DriverAssignmentInput = z.object({
  id: z.uuid(),
  truckId: z.uuid(),
  driverId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
});
export type DriverAssignmentInput = z.infer<typeof DriverAssignmentInput>;

const MAX_BATCH = 1000;

// Un lot de `simulator load` : chaque liste est facultative, tout est idempotent.
// Les relevés, pleins et messages sont enregistrés avec la source `history`.
export const HistoryLoadBatch = z
  .object({
    carriers: z.array(CarrierInput).max(MAX_BATCH).optional(),
    places: z.array(PlaceInput).max(MAX_BATCH).optional(),
    trucks: z.array(TruckInputRef).max(MAX_BATCH).optional(),
    drivers: z.array(DriverInput).max(MAX_BATCH).optional(),
    assignments: z.array(DriverAssignmentInput).max(MAX_BATCH).optional(),
    telemetry: z.array(TelemetryReading).max(MAX_BATCH).optional(),
    refuels: z.array(FuelCardTransaction).max(MAX_BATCH).optional(),
    messages: z.array(DriverMessageInput).max(MAX_BATCH).optional(),
  })
  .meta({ id: 'HistoryLoadBatch' });
export type HistoryLoadBatch = z.infer<typeof HistoryLoadBatch>;

const Counts = z.object({
  carriers: z.int(),
  places: z.int(),
  trucks: z.int(),
  drivers: z.int(),
  assignments: z.int(),
  telemetry: z.int(),
  refuels: z.int(),
  messages: z.int(),
});

export const HistoryLoadResult = z
  .object({ inserted: Counts })
  .meta({ id: 'HistoryLoadResult' });
export type HistoryLoadResult = z.infer<typeof HistoryLoadResult>;

export const ResetResult = z
  .object({
    deleted: z.object({
      telemetry: z.int(),
      refuels: z.int(),
      messages: z.int(),
      alerts: z.int(),
      investigations: z.int(),
      steps: z.int(),
      reviews: z.int(),
      tasks: z.int(),
    }),
  })
  .meta({ id: 'ResetResult' });
export type ResetResult = z.infer<typeof ResetResult>;
