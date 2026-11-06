import { computed, type Signal } from '@angular/core';
import type { AlertDetail } from '@fleet/contracts';
import type { TimeWindow } from '../../core/api.service';

const MARGIN_MS = 2 * 3_600_000;

const isIso = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value));

/**
 * Period to display for a tool: the one requested by the agent if it is valid,
 * otherwise the alert window ± 2 h. Equality by value so as not to reload on every poll.
 */
export function toolWindow(
  alert: Signal<AlertDetail>,
  args: Signal<Record<string, unknown>>,
): Signal<TimeWindow & { truckId: string }> {
  return computed(
    () => {
      const a = args();
      const truckId = alert().truck.id;
      if (isIso(a['from']) && isIso(a['to']) && Date.parse(a['to']) > Date.parse(a['from'])) {
        return { truckId, from: a['from'], to: a['to'] };
      }
      return {
        truckId,
        from: new Date(Date.parse(alert().windowStart) - MARGIN_MS).toISOString(),
        to: new Date(Date.parse(alert().windowEnd) + MARGIN_MS).toISOString(),
      };
    },
    { equal: (x, y) => x.truckId === y.truckId && x.from === y.from && x.to === y.to },
  );
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
