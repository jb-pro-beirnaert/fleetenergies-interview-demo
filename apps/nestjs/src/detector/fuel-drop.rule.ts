// Règle FUEL_DROP (spec 03, « Détecteur »). Volontairement naïve : l'agent fait le tri.

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
 * `window` : relevés du camion sur [R − 20 min, R], triés par date, R en dernier.
 * Anomalie si le niveau max de la fenêtre dépasse celui de R d'au moins `minDropL`
 * et que la vitesse est restée < 3 km/h entre ce max et R.
 */
export function evaluateFuelDrop(
  window: RuleReading[],
  minDropL: number,
): FuelDropAnomaly | null {
  const current = window.at(-1);
  if (!current) return null;

  // Niveau max ; à égalité, le plus récent (intervalle le plus court)
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

/** `episode` : relevés de [début de l'alerte, R], triés par date. */
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
