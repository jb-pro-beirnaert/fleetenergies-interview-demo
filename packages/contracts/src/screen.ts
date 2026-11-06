import { z } from 'zod';
import {
  AlertDecision,
  AlertStatus,
  AlertType,
  InvestigationStatus,
  PlaceType,
  ReviewDecision,
  StepKind,
  VerdictCategory,
} from './enums.ts';
import { Verdict } from './verdict.ts';

const isoDatetime = z.iso.datetime({ offset: true });

// Contexte d'alerte pour les agents (`GET /agent/alerts/:id`) : aucune donnée personnelle
export const AlertContext = z
  .object({
    alertId: z.uuid(),
    type: AlertType,
    truckId: z.uuid(),
    plate: z.string(),
    windowStart: isoDatetime,
    windowEnd: isoDatetime,
    dropL: z.number().nullable(),
    details: z.record(z.string(), z.unknown()),
    detectedAt: isoDatetime,
  })
  .meta({ id: 'AlertContext' });
export type AlertContext = z.infer<typeof AlertContext>;

export const AlertListQuery = z.object({
  status: AlertStatus.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AlertListQuery = z.infer<typeof AlertListQuery>;

export const AlertListItem = z
  .object({
    id: z.uuid(),
    type: AlertType,
    status: AlertStatus,
    decision: AlertDecision.nullable(),
    plate: z.string(),
    carrier: z.string(),
    detectedAt: isoDatetime,
    windowStart: isoDatetime,
    windowEnd: isoDatetime,
    dropL: z.number().nullable(),
    category: VerdictCategory.nullable(),
    confidence: z.number().nullable(),
    toolCallsCount: z.int().nullable(),
  })
  .meta({ id: 'AlertListItem' });
export type AlertListItem = z.infer<typeof AlertListItem>;

export const AlertList = z.array(AlertListItem).meta({ id: 'AlertList' });
export type AlertList = z.infer<typeof AlertList>;

export const InvestigationStepView = z.object({
  id: z.uuid(),
  attempt: z.int(),
  seq: z.int(),
  kind: StepKind,
  toolName: z.string().nullable(),
  toolCallId: z.string().nullable(),
  payload: z.unknown(),
  durationMs: z.int().nullable(),
  createdAt: isoDatetime,
});
export type InvestigationStepView = z.infer<typeof InvestigationStepView>;

export const AlertDetail = z
  .object({
    id: z.uuid(),
    type: AlertType,
    status: AlertStatus,
    decision: AlertDecision.nullable(),
    windowStart: isoDatetime,
    windowEnd: isoDatetime,
    dropL: z.number().nullable(),
    details: z.record(z.string(), z.unknown()),
    detectedAt: isoDatetime,
    truck: z.object({
      id: z.uuid(),
      plate: z.string(),
      make: z.string(),
      model: z.string(),
      carrier: z.string(),
      hasReefer: z.boolean(),
      tankCapacityL: z.number(),
    }),
    investigation: z
      .object({
        id: z.uuid(),
        status: InvestigationStatus,
        model: z.string().nullable(),
        promptVersion: z.string().nullable(),
        startedAt: isoDatetime.nullable(),
        finishedAt: isoDatetime.nullable(),
        durationSeconds: z.number().nullable(),
        category: VerdictCategory.nullable(),
        confidence: z.number().nullable(),
        summary: z.string().nullable(),
        verdict: Verdict.nullable(),
        toolCallsCount: z.int(),
        steps: z.array(InvestigationStepView),
      })
      .nullable(),
    review: z
      .object({
        decision: ReviewDecision,
        comment: z.string().nullable(),
        reviewedAt: isoDatetime,
      })
      .nullable(),
  })
  .meta({ id: 'AlertDetail' });
export type AlertDetail = z.infer<typeof AlertDetail>;

export const ScreenWindowQuery = z.object({
  from: isoDatetime,
  to: isoDatetime,
});
export type ScreenWindowQuery = z.infer<typeof ScreenWindowQuery>;

export const TankCurvePoints = z
  .array(
    z.object({
      at: isoDatetime,
      levelL: z.number(),
      speedKmh: z.number(),
      ignition: z.boolean(),
    }),
  )
  .meta({ id: 'TankCurvePoints' });
export type TankCurvePoints = z.infer<typeof TankCurvePoints>;

export const Positions = z
  .array(
    z.object({
      at: isoDatetime,
      lat: z.number(),
      lon: z.number(),
      speedKmh: z.number(),
      ignition: z.boolean(),
    }),
  )
  .meta({ id: 'Positions' });
export type Positions = z.infer<typeof Positions>;

export const PlaceView = z.object({
  id: z.uuid(),
  name: z.string(),
  type: PlaceType,
  brand: z.string().nullable(),
  lat: z.number(),
  lon: z.number(),
  radiusM: z.int(),
});
export type PlaceView = z.infer<typeof PlaceView>;

export const PlaceList = z.array(PlaceView).meta({ id: 'PlaceList' });
export type PlaceList = z.infer<typeof PlaceList>;

export const ReviewRequest = z
  .object({
    decision: ReviewDecision,
    comment: z.string().max(2000).optional(),
  })
  .meta({ id: 'ReviewRequest' });
export type ReviewRequest = z.infer<typeof ReviewRequest>;

export const ReviewResult = z
  .object({ alertId: z.uuid(), status: AlertStatus })
  .meta({ id: 'ReviewResult' });
export type ReviewResult = z.infer<typeof ReviewResult>;

export const Stats = z
  .object({
    alerts: z.object({
      total: z.int(),
      byStatus: z.record(z.string(), z.int()),
    }),
    ruleOnly: z.object({ toReviewManually: z.int() }),
    withAgents: z.object({
      autoClosed: z.int(),
      escalated: z.int(),
      pending: z.int(),
    }),
    investigations: z.object({
      avgDurationSeconds: z.number().nullable(),
      avgToolCalls: z.number().nullable(),
      failed: z.int(),
    }),
    humanAgreement: z.object({ reviewed: z.int(), agreed: z.int() }),
    model: z.string().nullable(),
    simulatedNow: isoDatetime.nullable(),
  })
  .meta({ id: 'Stats' });
export type Stats = z.infer<typeof Stats>;

export const Health = z
  .object({ status: z.literal('ok'), database: z.literal('ok') })
  .meta({ id: 'Health' });
export type Health = z.infer<typeof Health>;
