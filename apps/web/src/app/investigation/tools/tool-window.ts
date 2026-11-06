import { computed, type Signal } from '@angular/core';
import type { AlertDetail } from '@fleet/contracts';
import type { TimeWindow } from '../../core/api.service';

const MARGIN_MS = 2 * 3_600_000;

const isIso = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value));

/**
 * Période à afficher pour un outil : celle demandée par l'agent si elle est valide,
 * sinon la fenêtre de l'alerte ± 2 h. Égalité par valeur pour ne pas recharger à chaque polling.
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
