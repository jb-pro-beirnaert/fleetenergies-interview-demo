// Calculs des outils d'enquête (spec 02 et 03). Fonctions pures : le code calcule, jamais le LLM.
import { MAX_LIST_ITEMS, MAX_SAMPLES } from '@fleet/contracts';
import { MINUTE_MS, round1 } from '../common/serialize.js';

export const STOPPED_SPEED_KMH = 3;
export const DROP_MAX_SPAN_MS = 20 * MINUTE_MS;
export const STOP_MIN_DURATION_MS = 5 * MINUTE_MS;
export const SIMILAR_DROP_MIN_L = 25;
export const RECOVERY_MIN_L = 25;
export const RECOVERY_REFUEL_MARGIN_MS = 30 * MINUTE_MS;

export interface Reading {
  at: Date;
  lat: number;
  lon: number;
  speedKmh: number;
  ignition: boolean;
  fuelLevelL: number;
  odometerKm: number;
}

export interface PlaceRef {
  name: string;
  type: string;
  lat: number;
  lon: number;
  radiusM: number;
}

export interface LevelChange {
  from: Reading;
  to: Reading;
  /** Litres perdus (chute) ou gagnés (remontée), toujours positifs */
  liters: number;
  readings: Reading[];
}

const isStopped = (reading: Reading) => reading.speedKmh < STOPPED_SPEED_KMH;
const minutesBetween = (from: Date, to: Date) =>
  (to.getTime() - from.getTime()) / MINUTE_MS;

/**
 * Variations de niveau entre deux relevés distants d'au plus 20 min, sans chevauchement :
 * on retient d'abord la plus forte, puis la suivante qui ne la recoupe pas, etc.
 * `direction = 'drop'` : baisses, véhicule à l'arrêt sur tout l'intervalle.
 */
export function findLevelChanges(
  readings: Reading[],
  direction: 'drop' | 'rise',
  minLiters: number,
): LevelChange[] {
  const candidates: { i: number; j: number; liters: number }[] = [];
  for (let i = 0; i < readings.length; i++) {
    if (direction === 'drop' && !isStopped(readings[i])) continue;
    for (let j = i + 1; j < readings.length; j++) {
      if (
        readings[j].at.getTime() - readings[i].at.getTime() >
        DROP_MAX_SPAN_MS
      )
        break;
      if (direction === 'drop' && !isStopped(readings[j])) break;
      const delta = readings[i].fuelLevelL - readings[j].fuelLevelL;
      const liters = direction === 'drop' ? delta : -delta;
      if (liters >= minLiters && liters > 0) candidates.push({ i, j, liters });
    }
  }

  candidates.sort((a, b) => b.liters - a.liters);
  const kept: typeof candidates = [];
  for (const candidate of candidates) {
    const overlaps = kept.some((k) => candidate.i < k.j && k.i < candidate.j);
    if (!overlaps) kept.push(candidate);
  }
  return kept
    .sort((a, b) => a.i - b.i)
    .map(({ i, j, liters }) => ({
      from: readings[i],
      to: readings[j],
      liters: round1(liters),
      readings: readings.slice(i, j + 1),
    }));
}

/** 30 points max en conservant le premier, le dernier et les extremums (min/max par tranche). */
export function downsample<T>(
  points: T[],
  value: (point: T) => number,
  max = MAX_SAMPLES,
): T[] {
  if (points.length <= max) return points;
  const keep = new Set<number>([0, points.length - 1]);
  const indexOfExtremum = (from: number, to: number, pick: 'min' | 'max') => {
    let best = from;
    for (let k = from + 1; k < to; k++) {
      const better =
        pick === 'min'
          ? value(points[k]) < value(points[best])
          : value(points[k]) > value(points[best]);
      if (better) best = k;
    }
    return best;
  };
  keep.add(indexOfExtremum(0, points.length, 'min'));
  keep.add(indexOfExtremum(0, points.length, 'max'));

  const buckets = Math.floor((max - keep.size) / 2);
  const size = points.length / buckets;
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor(b * size);
    const to = Math.min(points.length, Math.floor((b + 1) * size));
    if (to <= from) continue;
    keep.add(indexOfExtremum(from, to, 'min'));
    keep.add(indexOfExtremum(from, to, 'max'));
  }
  return [...keep]
    .sort((a, b) => a - b)
    .slice(0, max)
    .map((index) => points[index]);
}

const EARTH_RADIUS_M = 6_371_000;

export function distanceMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Lieu le plus proche dont le rayon contient la position, sinon `null`. */
export function nearestPlace<P extends PlaceRef>(
  position: { lat: number; lon: number },
  places: P[],
): P | null {
  let best: { place: P; distance: number } | null = null;
  for (const place of places) {
    const distance = distanceMeters(position, place);
    if (distance <= place.radiusM && (!best || distance < best.distance)) {
      best = { place, distance };
    }
  }
  return best?.place ?? null;
}

export interface Stop {
  from: Reading;
  to: Reading;
  durationMin: number;
  ignitionOff: boolean;
  readings: Reading[];
}

/** Arrêt : suite de relevés à vitesse < 3 km/h pendant au moins 5 min. */
export function findStops(readings: Reading[]): Stop[] {
  const stops: Stop[] = [];
  let run: Reading[] = [];
  const flush = () => {
    if (run.length >= 2) {
      const from = run[0];
      const to = run[run.length - 1];
      if (to.at.getTime() - from.at.getTime() >= STOP_MIN_DURATION_MS) {
        const off = run.filter((reading) => !reading.ignition).length;
        stops.push({
          from,
          to,
          durationMin: Math.round(minutesBetween(from.at, to.at)),
          // Moteur coupé sur la majorité des relevés de l'arrêt
          ignitionOff: off * 2 >= run.length,
          readings: run,
        });
      }
    }
    run = [];
  };
  for (const reading of readings) {
    if (isStopped(reading)) run.push(reading);
    else flush();
  }
  flush();
  return stops;
}

/** Garde les `max` plus longs arrêts, remis dans l'ordre chronologique. */
export function longestStops(stops: Stop[], max = MAX_LIST_ITEMS): Stop[] {
  return [...stops]
    .sort((a, b) => b.durationMin - a.durationMin)
    .slice(0, max)
    .sort((a, b) => a.from.at.getTime() - b.from.at.getTime());
}

export function distanceKm(readings: Reading[]): number {
  if (readings.length < 2) return 0;
  return round1(
    Math.max(
      0,
      readings[readings.length - 1].odometerKm - readings[0].odometerKm,
    ),
  );
}

/** Minutes en mouvement : intervalles entre relevés consécutifs dont l'arrivée est à ≥ 3 km/h. */
export function movingMinutes(readings: Reading[]): number {
  let total = 0;
  for (let k = 1; k < readings.length; k++) {
    if (!isStopped(readings[k]))
      total += minutesBetween(readings[k - 1].at, readings[k].at);
  }
  return Math.round(total);
}

/** Heures moteur tournant à l'arrêt : intervalles dont les deux relevés sont arrêtés, contact mis. */
export function idleHours(readings: Reading[]): number {
  let minutes = 0;
  for (let k = 1; k < readings.length; k++) {
    const [a, b] = [readings[k - 1], readings[k]];
    if (isStopped(a) && isStopped(b) && a.ignition && b.ignition) {
      minutes += minutesBetween(a.at, b.at);
    }
  }
  return minutes / 60;
}

export interface FuelBalanceInput {
  readings: Reading[];
  refueledL: number;
  baselineLPer100km: number;
  idleLPerHour: number;
}

/**
 * Bilan carburant (spec 02) :
 * attendu = km × conso/100 + heures au ralenti × conso ralenti ;
 * inexpliqué = baisse observée + pleins − attendu.
 */
export function computeFuelBalance(input: FuelBalanceInput) {
  const { readings, refueledL, baselineLPer100km, idleLPerHour } = input;
  const km = distanceKm(readings);
  const moving = (km * baselineLPer100km) / 100;
  const idle = idleHours(readings) * idleLPerHour;
  const expected = moving + idle;
  const observed =
    readings.length > 0
      ? readings[0].fuelLevelL - readings[readings.length - 1].fuelLevelL
      : 0;
  return {
    distanceKm: km,
    movingConsumptionL: round1(moving),
    idleConsumptionL: round1(idle),
    expectedConsumptionL: round1(expected),
    refueledL: round1(refueledL),
    observedLevelChangeL: round1(observed),
    unexplainedLossL: round1(observed + refueledL - expected),
  };
}

/** Remontées ≥ 25 L sans plein enregistré à ± 30 min : signe d'artefact de sonde. */
export function findRecoveries(readings: Reading[], refuelTimes: Date[]) {
  return findLevelChanges(readings, 'rise', RECOVERY_MIN_L)
    .filter(
      (rise) =>
        !refuelTimes.some(
          (time) =>
            time.getTime() >=
              rise.from.at.getTime() - RECOVERY_REFUEL_MARGIN_MS &&
            time.getTime() <= rise.to.at.getTime() + RECOVERY_REFUEL_MARGIN_MS,
        ),
    )
    .map((rise) => ({ at: rise.to.at.toISOString(), liters: rise.liters }));
}

const PARIS_HOUR = new Intl.DateTimeFormat('en-GB', {
  hour: 'numeric',
  hourCycle: 'h23',
  timeZone: 'Europe/Paris',
});

/** Heure locale (Europe/Paris) : « la nuit » doit se lire en heure française. */
export function hourOfDayParis(date: Date): number {
  const hour = PARIS_HOUR.formatToParts(date).find(
    (part) => part.type === 'hour',
  );
  return Number(hour?.value);
}
