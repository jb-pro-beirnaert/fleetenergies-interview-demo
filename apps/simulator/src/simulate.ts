// Physics engine of a truck (spec 04, "Physics"). One-minute resolution,
// one reading emitted every 5 minutes. The day plans drive the truck
// through `stayUntil`, `driveTo`, `refuelIfBelow`.

import { lerp, roadKm } from './geo.ts';
import { round, type Rng } from './rng.ts';
import { STEP_MIN } from './time.ts';
import type { PlaceDef, TruckDef, World } from './world.ts';

export const REFUEL_THRESHOLD = 0.3;
export const REFUEL_TARGET = 0.95;
const REFUEL_STOP_MIN = 15;
const REFUEL_AT_OFFSET_MIN = 6;
const IDLE_MIN = 3;
const STOPPED_NOISE_L = 1.5;
const MOVING_NOISE_L = 4;
/** Average speed used to estimate travel times when planning. */
export const PLANNING_SPEED_KMH = 75;

export interface SimReading {
  minute: number;
  lat: number;
  lon: number;
  speedKmh: number;
  ignition: boolean;
  /** Real level (without noise or artefact), for the tests. */
  trueLevelL: number;
  /** Level measured by the sensor. */
  fuelLevelL: number;
  odometerKm: number;
}

export interface SimRefuel {
  minute: number;
  placeCode: string;
  liters: number;
  unitPriceEur: number;
  totalEur: number;
}

export interface SimStay {
  placeCode: string;
  start: number;
  end: number;
}

/** Actual fuel withdrawal (theft, transfer, draining), spread linearly. */
export interface Drain {
  start: number;
  minutes: number;
  liters: number;
  label: string;
}

export interface DayStats {
  km: number;
  idleMin: number;
  drainedL: number;
}

interface Tick {
  speedKmh: number;
  ignition: boolean;
  km: number;
  fuelL: number;
  lat: number;
  lon: number;
}

export interface TruckStart {
  placeCode: string;
  levelL: number;
  odometerKm: number;
}

export class TruckSim {
  readonly truck: TruckDef;
  readonly world: World;
  readonly rng: Rng;
  t = 0;
  lat: number;
  lon: number;
  odometerKm: number;
  levelL: number;
  /** Place where the truck is, `null` while driving. */
  placeCode: string | null;
  readonly readings: SimReading[] = [];
  readonly refuels: SimRefuel[] = [];
  readonly stays: SimStay[] = [];
  readonly drains: Drain[] = [];
  readonly dayStats: DayStats[];

  constructor(truck: TruckDef, world: World, rng: Rng, start: TruckStart) {
    this.truck = truck;
    this.world = world;
    this.rng = rng;
    this.dayStats = Array.from({ length: world.cal.days }, () => ({ km: 0, idleMin: 0, drainedL: 0 }));
    const home = world.place(start.placeCode);
    this.lat = home.lat;
    this.lon = home.lon;
    this.placeCode = home.code;
    this.levelL = start.levelL;
    this.odometerKm = start.odometerKm;
    this.emit(0, false);
  }

  get place(): PlaceDef | null {
    return this.placeCode ? this.world.place(this.placeCode) : null;
  }

  private fail(message: string): never {
    throw new Error(
      `${this.truck.code} on ${this.world.cal.date(this.world.cal.dayOf(this.t))} at ${this.world.cal.hhmm(this.t)}: ${message}`,
    );
  }

  private emit(speedKmh: number, ignition: boolean): void {
    const noise = speedKmh > 0 ? MOVING_NOISE_L : STOPPED_NOISE_L;
    const measured = this.levelL + this.rng.float(-noise, noise);
    this.readings.push({
      minute: this.t,
      lat: round(this.lat, 6),
      lon: round(this.lon, 6),
      speedKmh: round(speedKmh, 1),
      ignition,
      trueLevelL: this.levelL,
      fuelLevelL: round(Math.min(Math.max(measured, 0), this.truck.tankCapacityL), 1),
      odometerKm: round(this.odometerKm, 1),
    });
  }

  /** Advances by one minute. */
  private tick(move: Tick): void {
    const { cal } = this.world;
    if (this.t >= cal.endMin) this.fail('beyond the simulated period');
    const stats = this.dayStats[cal.dayOf(this.t)];
    this.odometerKm += move.km;
    stats.km += move.km;
    this.levelL -= move.fuelL;
    if (move.speedKmh === 0 && move.ignition) {
      this.levelL -= this.truck.idleLPerHour / 60;
      stats.idleMin++;
    }
    for (const drain of this.drains) {
      if (this.t >= drain.start && this.t < drain.start + drain.minutes) {
        if (move.speedKmh > 0) this.fail(`withdrawal "${drain.label}" during a trip`);
        this.levelL -= drain.liters / drain.minutes;
        stats.drainedL += drain.liters / drain.minutes;
      }
    }
    if (this.levelL < 0) this.fail('negative level');
    this.lat = move.lat;
    this.lon = move.lon;
    this.t++;
    if (this.t % STEP_MIN === 0 && this.t < cal.endMin) this.emit(move.speedKmh, move.ignition);
  }

  private recordStay(start: number, end: number): void {
    const code = this.placeCode;
    if (!code) this.fail('stop outside any place');
    const last = this.stays.at(-1);
    if (last && last.placeCode === code && last.end === start) last.end = end;
    else this.stays.push({ placeCode: code, start, end });
  }

  private stopped(ignition: boolean): Tick {
    return { speedKmh: 0, ignition, km: 0, fuelL: 0, lat: this.lat, lon: this.lon };
  }

  /** Stays put until `until`; engine idling a few minutes at the start and at the end. */
  stayUntil(until: number, idle = { start: IDLE_MIN, end: IDLE_MIN }): void {
    const end = Math.min(until, this.world.cal.endMin);
    if (end <= this.t) return;
    const start = this.t;
    this.recordStay(start, end);
    while (this.t < end) {
      const ignition = this.t - start < idle.start || end - this.t <= idle.end;
      this.tick(this.stopped(ignition));
    }
  }

  stayFor(minutes: number): void {
    this.stayUntil(this.t + minutes);
  }

  /** Estimated trip duration (planning). */
  driveMinutes(from: string, to: string): number {
    if (from === to) return 0;
    return (roadKm(this.world.place(from), this.world.place(to)) / PLANNING_SPEED_KMH) * 60;
  }

  /**
   * Trip to a place. If the level risks falling below 30% of capacity,
   * stop at the fuel station that lengthens the trip the least (refuel to 95%).
   */
  driveTo(code: string): void {
    if (code === this.placeCode) return;
    const destination = this.world.place(code);
    const here = { lat: this.lat, lon: this.lon };
    const estimateL = (roadKm(here, destination) * this.truck.baselineLPer100km * 1.08) / 100;
    const low = this.levelL - estimateL < REFUEL_THRESHOLD * this.truck.tankCapacityL;
    if (low && destination.type !== 'fuel_station') {
      if (this.place?.type === 'fuel_station') {
        this.refuelHere();
      } else {
        const station = this.world.places
          .filter((p) => p.type === 'fuel_station')
          .reduce((best, p) =>
            roadKm(here, p) + roadKm(p, destination) < roadKm(here, best) + roadKm(best, destination)
              ? p
              : best,
          );
        this.driveLeg(station);
        this.refuelHere();
      }
    }
    this.driveLeg(destination);
    if (low && destination.type === 'fuel_station') this.refuelHere();
  }

  /** Direct trip: linear interpolation, speed 70-85 km/h, reference consumption ± 6%. */
  private driveLeg(destination: PlaceDef): void {
    const from = { lat: this.lat, lon: this.lon };
    const km = roadKm(from, destination);
    const cruise = this.rng.float(70, 85);
    const minutes = Math.max(1, Math.round((km / cruise) * 60));
    const litersPerKm = (this.truck.baselineLPer100km / 100) * this.rng.float(0.94, 1.06);
    this.placeCode = null;
    for (let i = 1; i <= minutes; i++) {
      const position = lerp(from, destination, i / minutes);
      this.tick({
        speedKmh: cruise + this.rng.float(-3, 3),
        ignition: true,
        km: km / minutes,
        fuelL: (km / minutes) * litersPerKm,
        lat: position.lat,
        lon: position.lon,
      });
    }
    // Stop position slightly offset from the centre of the place (a few metres)
    this.lat = destination.lat + this.rng.float(-0.0001, 0.0001);
    this.lon = destination.lon + this.rng.float(-0.0001, 0.0001);
    this.placeCode = destination.code;
  }

  /** 15-min stop at a fuel station, refuel to 95% of capacity, fuel card transaction. */
  private refuelHere(): void {
    const station = this.place;
    if (station?.type !== 'fuel_station') this.fail('refuel outside a fuel station');
    const start = this.t;
    this.recordStay(start, start + REFUEL_STOP_MIN);
    for (let offset = 0; offset < REFUEL_STOP_MIN; offset++) {
      if (offset === REFUEL_AT_OFFSET_MIN) {
        const liters = round(REFUEL_TARGET * this.truck.tankCapacityL - this.levelL, 1);
        if (liters > 0) {
          const unitPriceEur = round(this.rng.float(1.62, 1.78), 3);
          this.levelL += liters;
          this.refuels.push({
            minute: this.t,
            placeCode: station.code,
            liters,
            unitPriceEur,
            totalEur: round(liters * unitPriceEur, 2),
          });
        }
      }
      this.tick(this.stopped(offset < 2 || offset >= REFUEL_STOP_MIN - 2));
    }
  }

  /** Preventive refuel at the nearest fuel station if the level is below `fraction`. */
  refuelIfBelow(fraction: number): void {
    if (this.levelL >= fraction * this.truck.tankCapacityL) return;
    const here = { lat: this.lat, lon: this.lon };
    const station = this.world.places
      .filter((p) => p.type === 'fuel_station')
      .reduce((best, p) => (roadKm(here, p) < roadKm(here, best) ? p : best));
    if (station.code !== this.placeCode) this.driveLeg(station);
    this.refuelHere();
  }

  /** Ongoing stop at a given minute. */
  stayAt(minute: number): SimStay | undefined {
    return this.stays.find((stay) => stay.start <= minute && minute < stay.end);
  }
}
