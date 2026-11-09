import type {
  AlertDetail,
  AlertStatus,
  AlertType,
  InvoiceStatus,
  PlaceType,
  VerdictCategory,
} from '@fleet/contracts';
import { type MessageKey, t } from './i18n/i18n';

// Display order (histogram)
export const CATEGORIES: readonly VerdictCategory[] = [
  'theft_suspected',
  'sensor_fault',
  'equipment_transfer',
  'legitimate_operation',
  'billing_discrepancy',
  'inconclusive',
];

// Labels are read at call time, in the current language
export const categoryLabel = (category: VerdictCategory) => t(`category.${category}`);
export const statusLabel = (status: AlertStatus) => t(`status.${status}`);
export const alertTypeLabel = (type: AlertType) => t(`alertType.${type}`);
export const placeTypeLabel = (type: PlaceType) => t(`placeType.${type}`);
export const invoiceStatusLabel = (status: InvoiceStatus) => t(`invoiceStatus.${status}`);

/** Colour family of an invoice status pill. */
export function invoiceStatusTone(status: InvoiceStatus): 'neutral' | 'progress' | 'ok' | 'warn' | 'bad' {
  switch (status) {
    case 'extracting':
      return 'progress';
    case 'matched':
      return 'ok';
    case 'needs_review':
      return 'warn';
    case 'mismatch':
    case 'failed':
      return 'bad';
    default:
      return 'neutral';
  }
}

export const PLACE_TYPE_COLORS: Record<PlaceType, string> = {
  fuel_station: '#2563eb',
  depot: '#475569',
  workshop: '#7c3aed',
  rest_area: '#ea580c',
  customer: '#0d9488',
  other: '#94a3b8',
};

const TOOL_NAMES = new Set([
  'get_truck_profile',
  'get_tank_curve',
  'get_vehicle_activity',
  'find_fuel_transactions',
  'read_driver_messages',
  'compute_fuel_balance',
  'find_similar_events',
]);

/** Readable phrase for each investigation tool */
export const toolPhrase = (toolName: string | null) =>
  toolName && TOOL_NAMES.has(toolName)
    ? t(`tool.${toolName}` as MessageKey)
    : t('tool.other', { name: toolName ?? t('tool.unknownName') });

// Categories always escalated by the API (spec 03, "Decision after the verdict")
const ALWAYS_ESCALATED: ReadonlySet<VerdictCategory> = new Set([
  'theft_suspected',
  'billing_discrepancy',
  'inconclusive',
]);

/**
 * Readable reason for the API decision. The API does not return the rule it applied:
 * it is rebuilt from the category and the failure reason, if any.
 */
export function decisionReason(alert: AlertDetail): string | null {
  const failure = alert.details['failure'];
  if (failure !== undefined && alert.decision !== 'auto_closed') {
    return t('decision.failed', {
      reason: typeof failure === 'string' ? failure : JSON.stringify(failure),
    });
  }
  const category = alert.investigation?.category;
  if (!alert.decision || !category) return null;
  if (alert.decision === 'auto_closed') return t('decision.autoClosed');
  if (alert.type === 'billing_mismatch') return t('decision.billingAlwaysEscalated');
  if (ALWAYS_ESCALATED.has(category)) {
    return t('decision.alwaysEscalated', { category: categoryLabel(category) });
  }
  return t('decision.lowConfidence');
}
