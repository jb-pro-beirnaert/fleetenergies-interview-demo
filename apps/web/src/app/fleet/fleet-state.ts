import type { FleetReading, TruckState } from '@fleet/contracts';
import { t } from '../core/i18n/i18n';

// Same threshold as the API (`STOPPED_SPEED_KMH`): below it, the truck is stopped
const STOPPED_SPEED_KMH = 3;

export const TRUCK_STATES: readonly TruckState[] = ['moving', 'idling', 'parked', 'no_data'];

// Leaflet and Chart.js need real colours: aligned with the stylesheet variables
export const STATE_COLORS: Record<TruckState, string> = {
  moving: '#2563eb', // --accent
  idling: '#ea580c', // --orange
  parked: '#64748b', // --muted
  no_data: '#cbd5e1',
};

export const stateLabel = (state: TruckState) => t(`fleet.state.${state}`);

/** State of a truck at a given reading (same rule as the API for the latest one) */
export function readingState(reading: FleetReading): Exclude<TruckState, 'no_data'> {
  if (reading.speedKmh >= STOPPED_SPEED_KMH) return 'moving';
  return reading.ignition ? 'idling' : 'parked';
}
