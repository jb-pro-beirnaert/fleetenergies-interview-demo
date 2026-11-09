// Fleet overview calculations (screen route `GET /api/fleet`). Pure functions.
import type { TruckState } from '@fleet/contracts';
import { STOPPED_SPEED_KMH } from '../investigation-data/calculations.js';

/** A truck without a reading for more than 30 min before the window end is shown as `no_data` */
export const STALE_AFTER_MS = 30 * 60_000;

export function truckState(
  last: { at: Date; speedKmh: number; ignition: boolean } | null,
  windowEnd: Date | null,
): TruckState {
  if (!last || !windowEnd) return 'no_data';
  if (windowEnd.getTime() - last.at.getTime() > STALE_AFTER_MS)
    return 'no_data';
  if (last.speedKmh >= STOPPED_SPEED_KMH) return 'moving';
  return last.ignition ? 'idling' : 'parked';
}
