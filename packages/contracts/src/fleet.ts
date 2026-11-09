import { z } from 'zod';
import { AlertStatus } from './enums.ts';

const isoDatetime = z.iso.datetime({ offset: true });

// Fleet overview (`GET /api/fleet`): received telemetry of every truck over a sliding window
// ending at the latest reading (simulated time). Screen route, no agent sees it.

export const FleetQuery = z.object({
  hours: z.coerce.number().int().min(1).max(72).default(24),
});
export type FleetQuery = z.infer<typeof FleetQuery>;

/** From the latest reading: moving (≥ 3 km/h), idling (stopped, engine on), parked (engine off) */
export const TruckState = z.enum(['moving', 'idling', 'parked', 'no_data']);
export type TruckState = z.infer<typeof TruckState>;

export const FleetReading = z.object({
  at: isoDatetime,
  lat: z.number(),
  lon: z.number(),
  speedKmh: z.number(),
  ignition: z.boolean(),
  levelL: z.number(),
});
export type FleetReading = z.infer<typeof FleetReading>;

export const FleetTruck = z.object({
  id: z.uuid(),
  plate: z.string(),
  carrier: z.string(),
  make: z.string(),
  model: z.string(),
  hasReefer: z.boolean(),
  tankCapacityL: z.number(),
  state: TruckState,
  /** Latest reading in the window, `null` if none */
  last: FleetReading.nullable(),
  /** Every reading of the window (one every 5 min), oldest first */
  readings: z.array(FleetReading),
  distanceKm: z.number(),
  movingMinutes: z.int(),
  refuels: z.array(z.object({ at: isoDatetime, liters: z.number() })),
  alerts: z.array(
    z.object({
      id: z.uuid(),
      status: AlertStatus,
      windowStart: isoDatetime,
      windowEnd: isoDatetime,
      dropL: z.number().nullable(),
    }),
  ),
});
export type FleetTruck = z.infer<typeof FleetTruck>;

export const FleetOverview = z
  .object({
    /** Window bounds; `null` while no reading has been received */
    from: isoDatetime.nullable(),
    to: isoDatetime.nullable(),
    hours: z.int(),
    trucks: z.array(FleetTruck),
  })
  .meta({ id: 'FleetOverview' });
export type FleetOverview = z.infer<typeof FleetOverview>;
