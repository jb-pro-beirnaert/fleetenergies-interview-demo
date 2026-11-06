import { z } from 'zod';
import { PlaceType, VerdictCategory } from './enums.ts';

// Limites communes aux 7 outils d'enquête (spec 02)
export const MAX_WINDOW_HOURS = 72;
export const MAX_SAMPLES = 30;
export const MAX_LIST_ITEMS = 20;

const isoDatetime = z.iso.datetime({ offset: true });

type Window = { from: string; to: string };

const checkWindow = (value: Window, ctx: z.core.$RefinementCtx<Window>) => {
  const from = Date.parse(value.from);
  const to = Date.parse(value.to);
  if (to <= from) {
    ctx.addIssue({
      code: 'custom',
      path: ['to'],
      message: '`to` doit être postérieur à `from`',
    });
  } else if (to - from > MAX_WINDOW_HOURS * 3_600_000) {
    ctx.addIssue({
      code: 'custom',
      path: ['to'],
      message: `fenêtre maximale ${MAX_WINDOW_HOURS} h`,
    });
  }
};

// Paramètres de query des routes `/agent/trucks/:truckId/*`
export const TimeWindowQuery = z
  .object({ from: isoDatetime, to: isoDatetime })
  .superRefine(checkWindow);
export type TimeWindowQuery = z.infer<typeof TimeWindowQuery>;

export const SimilarEventsQuery = z.object({
  lookbackDays: z.coerce.number().int().min(1).max(30),
});
export type SimilarEventsQuery = z.infer<typeof SimilarEventsQuery>;

// Entrées des outils MCP (truckId inclus)
export const TruckInput = z.object({ truckId: z.uuid() });
export type TruckInput = z.infer<typeof TruckInput>;

export const TruckWindowInput = z
  .object({ truckId: z.uuid(), from: isoDatetime, to: isoDatetime })
  .superRefine(checkWindow);
export type TruckWindowInput = z.infer<typeof TruckWindowInput>;

export const SimilarEventsInput = z.object({
  truckId: z.uuid(),
  lookbackDays: z.int().min(1).max(30),
});
export type SimilarEventsInput = z.infer<typeof SimilarEventsInput>;

// Sorties
export const TruckProfile = z
  .object({
    plate: z.string(),
    make: z.string(),
    model: z.string(),
    energy: z.string(),
    tankCapacityL: z.number(),
    hasReefer: z.boolean(),
    baselineLPer100km: z.number(),
    idleLPerHour: z.number(),
    homeDepot: z.string(),
    sensorNotes: z.string().nullable(),
  })
  .meta({ id: 'TruckProfile' });
export type TruckProfile = z.infer<typeof TruckProfile>;

export const TankCurve = z
  .object({
    startLevelL: z.number(),
    endLevelL: z.number(),
    minLevelL: z.number(),
    maxLevelL: z.number(),
    biggestDrop: z
      .object({
        from: isoDatetime,
        to: isoDatetime,
        liters: z.number(),
        durationMin: z.number(),
        ignitionOff: z.boolean(),
        maxSpeedKmh: z.number(),
      })
      .nullable(),
    recoveries: z.array(z.object({ at: isoDatetime, liters: z.number() })),
    samples: z
      .array(z.object({ at: isoDatetime, levelL: z.number() }))
      .max(MAX_SAMPLES),
  })
  .meta({ id: 'TankCurve' });
export type TankCurve = z.infer<typeof TankCurve>;

export const VehicleActivity = z
  .object({
    distanceKm: z.number(),
    movingMinutes: z.number(),
    stops: z
      .array(
        z.object({
          from: isoDatetime,
          to: isoDatetime,
          durationMin: z.number(),
          ignitionOff: z.boolean(),
          place: z.object({ name: z.string(), type: PlaceType }).nullable(),
          lat: z.number(),
          lon: z.number(),
        }),
      )
      .max(MAX_LIST_ITEMS),
  })
  .meta({ id: 'VehicleActivity' });
export type VehicleActivity = z.infer<typeof VehicleActivity>;

export const FuelTransactions = z
  .object({
    refuels: z
      .array(
        z.object({
          at: isoDatetime,
          place: z.string().nullable(),
          liters: z.number(),
          totalEur: z.number().nullable(),
          source: z.string(),
          invoiceId: z.uuid().nullable(),
        }),
      )
      .max(MAX_LIST_ITEMS),
  })
  .meta({ id: 'FuelTransactions' });
export type FuelTransactions = z.infer<typeof FuelTransactions>;

export const DriverMessages = z
  .object({
    messages: z
      .array(
        z.object({
          sentAt: isoDatetime,
          driver: z.string(), // pseudonyme
          body: z.string(), // masqué
        }),
      )
      .max(MAX_LIST_ITEMS),
  })
  .meta({ id: 'DriverMessages' });
export type DriverMessages = z.infer<typeof DriverMessages>;

export const FuelBalance = z
  .object({
    distanceKm: z.number(),
    movingConsumptionL: z.number(),
    idleConsumptionL: z.number(),
    expectedConsumptionL: z.number(),
    refueledL: z.number(),
    observedLevelChangeL: z.number(),
    unexplainedLossL: z.number(),
  })
  .meta({ id: 'FuelBalance' });
export type FuelBalance = z.infer<typeof FuelBalance>;

export const SimilarEvents = z
  .object({
    events: z
      .array(
        z.object({
          at: isoDatetime,
          dropL: z.number(),
          hourOfDay: z.int().min(0).max(23),
          placeType: PlaceType.nullable(),
          ignitionOff: z.boolean(),
          alertId: z.uuid().nullable(),
          verdictCategory: VerdictCategory.nullable(),
        }),
      )
      .max(MAX_LIST_ITEMS),
  })
  .meta({ id: 'SimilarEvents' });
export type SimilarEvents = z.infer<typeof SimilarEvents>;
