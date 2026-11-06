import { z } from 'zod';

// Valeurs identiques aux enums SQL (spec 01)

export const VerdictCategory = z.enum([
  'theft_suspected',
  'sensor_fault',
  'equipment_transfer',
  'legitimate_operation',
  'billing_discrepancy',
  'inconclusive',
]);
export type VerdictCategory = z.infer<typeof VerdictCategory>;

export const TaskType = z.enum(['investigate_alert']);
export type TaskType = z.infer<typeof TaskType>;

export const TaskStatus = z.enum(['pending', 'in_progress', 'done', 'failed']);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const AlertType = z.enum(['fuel_drop']);
export type AlertType = z.infer<typeof AlertType>;

export const AlertStatus = z.enum([
  'detected',
  'investigating',
  'closed',
  'escalated',
  'confirmed',
  'dismissed',
]);
export type AlertStatus = z.infer<typeof AlertStatus>;

export const AlertDecision = z.enum(['auto_closed', 'escalated']);
export type AlertDecision = z.infer<typeof AlertDecision>;

export const InvestigationStatus = z.enum(['running', 'completed', 'failed']);
export type InvestigationStatus = z.infer<typeof InvestigationStatus>;

export const StepKind = z.enum([
  'reasoning',
  'tool_call',
  'tool_result',
  'retry',
  'error',
  'verdict',
]);
export type StepKind = z.infer<typeof StepKind>;

export const ReviewDecision = z.enum(['confirm', 'dismiss']);
export type ReviewDecision = z.infer<typeof ReviewDecision>;

export const DataSource = z.enum(['history', 'live']);
export type DataSource = z.infer<typeof DataSource>;

export const RefuelSource = z.enum(['fuel_card']);
export type RefuelSource = z.infer<typeof RefuelSource>;

export const PlaceType = z.enum([
  'fuel_station',
  'depot',
  'workshop',
  'rest_area',
  'customer',
  'other',
]);
export type PlaceType = z.infer<typeof PlaceType>;

export const Energy = z.enum(['diesel', 'b100', 'hvo']);
export type Energy = z.infer<typeof Energy>;
