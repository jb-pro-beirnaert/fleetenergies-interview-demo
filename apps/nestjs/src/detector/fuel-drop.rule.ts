// FUEL_DROP rule (spec 03, "Detector"). Deliberately naive: the agent sorts things out.

export const DETECTION_WINDOW_MS = 20 * 60_000;
export const DEDUP_WINDOW_MS = 30 * 60_000;
export const STOPPED_SPEED_KMH = 3;

export interface RuleReading {
  recordedAt: Date;
  speedKmh: number;
  ignition: boolean;
  fuelLevelL: number;
  lat: number;
  lon: number;
}

export interface FuelDropAnomaly {
  startAt: Date;
  endAt: Date;
  dropL: number;
}

export interface FuelDropDetails {
  levelBeforeL: number;
  levelAfterL: number;
  maxSpeedKmh: number;
  ignitionOffShare: number;
  lat: number;
  lon: number;
}

/**
 * `window`: the truck's readings over [R − 20 min, R], sorted by date, R last.
 * Anomaly if the window's max level exceeds R's by at least `minDropL`
 * and the speed stayed < 3 km/h between that max and R.
 */
export function evaluateFuelDrop(
  window: RuleReading[],
  minDropL: number,
): FuelDropAnomaly | null {
  const current = window.at(-1);
  if (!current) return null;

  // Max level; on a tie, the most recent (shortest interval)
  let maxIndex = 0;
  window.forEach((reading, index) => {
    if (reading.fuelLevelL >= window[maxIndex].fuelLevelL) maxIndex = index;
  });
  const max = window[maxIndex];
  const dropL = max.fuelLevelL - current.fuelLevelL;
  if (dropL < minDropL) return null;

  const stopped = window
    .slice(maxIndex)
    .every((reading) => reading.speedKmh < STOPPED_SPEED_KMH);
  if (!stopped) return null;

  return { startAt: max.recordedAt, endAt: current.recordedAt, dropL };
}

/** `episode`: readings over [alert start, R], sorted by date. */
export function buildDropDetails(episode: RuleReading[]): FuelDropDetails {
  const first = episode[0];
  const last = episode.at(-1) ?? first;
  const ignitionOff = episode.filter((reading) => !reading.ignition).length;
  return {
    levelBeforeL: first.fuelLevelL,
    levelAfterL: last.fuelLevelL,
    maxSpeedKmh: Math.max(...episode.map((reading) => reading.speedKmh)),
    ignitionOffShare: Math.round((ignitionOff / episode.length) * 100) / 100,
    lat: last.lat,
    lon: last.lon,
  };
}
