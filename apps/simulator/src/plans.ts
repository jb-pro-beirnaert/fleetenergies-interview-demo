// Day plans: random typical day, and scripted days for the scenario trucks
// on the day of their scenario (the truck must be stopped at the right place type at the planned time).

import { roadKm } from './geo.ts';
import { createRng, round, type Rng } from './rng.ts';
import { HISTORY_EVENTS, SCENARIOS } from './scenarios.ts';
import { TruckSim } from './simulate.ts';
import type { TruckDef, World } from './world.ts';

type DayPlan = (sim: TruckSim, rng: Rng, day: number) => void;

/** Minute of a Paris local time for a simulated day. */
const at = (sim: TruckSim, day: number, hhmm: string): number => sim.world.cal.at(day, hhmm);

/** Planning margin to absorb a possible detour via a fuel station. */
const SLACK_MIN = 25;

interface TripOptions {
  /** Latest arrival time at `next`. */
  until: number;
  /** Place to reach after the deliveries. */
  next: string;
  maxVisits: number;
  exclude?: readonly string[];
}

/** Chains deliveries as long as there is time left to reach `next` before `until`. */
export function runTrips(sim: TruckSim, rng: Rng, options: TripOptions): void {
  for (let visit = 0; visit < options.maxVisits; visit++) {
    const here = sim.placeCode;
    if (!here) throw new Error(`${sim.truck.code}: delivery outside any place`);
    const stayMin = rng.int(30, 90);
    const destination = rng
      .shuffle(sim.truck.customers)
      .filter((c) => c !== here && c !== options.next && !options.exclude?.includes(c))
      .find(
        (c) =>
          sim.t + sim.driveMinutes(here, c) + stayMin + sim.driveMinutes(c, options.next) + SLACK_MIN <=
          options.until,
      );
    if (!destination) return;
    sim.driveTo(destination);
    sim.stayFor(stayMin);
  }
}

const nearestRestArea = (sim: TruckSim): string => {
  const here = { lat: sim.lat, lon: sim.lon };
  return sim.world.places
    .filter((p) => p.type === 'rest_area')
    .reduce((best, p) => (roadKm(here, p) < roadKm(here, best) ? p : best)).code;
};

/**
 * Typical day: departure between 05:30 and 07:30, 1 to 3 deliveries, back to the depot;
 * night at the nearest rest area for a long-haul truck (except on Saturday),
 * or when `nightOnRestArea` requires it (day before a night-time episode at a rest area).
 */
export const workday = (
  sim: TruckSim,
  rng: Rng,
  day: number,
  options: { departAt?: number; nightOnRestArea?: boolean } = {},
): void => {
  const saturday = sim.world.cal.weekday(day) === 6;
  sim.stayUntil(options.departAt ?? at(sim, day, '05:30') + rng.int(0, 120));
  runTrips(sim, rng, {
    until: at(sim, day, '19:30'),
    next: sim.truck.homeDepot,
    maxVisits: saturday ? 1 : rng.int(1, 3),
  });
  const restArea = options.nightOnRestArea ?? (sim.truck.longHaul && !saturday);
  sim.driveTo(restArea ? nearestRestArea(sim) : sim.truck.homeDepot);
};

/** Scripted day of each scenario truck, played on the day of its scenario. */
const SCENARIO_SCRIPTS: Record<string, DayPlan> = {
  // S6: artefact at the depot at 05:50, departure afterwards
  T01: (sim, rng, day) => workday(sim, rng, day, { departAt: at(sim, day, '06:35') }),

  // S2: at the loading bay of the Fos customer from ~06:30 to 08:05
  T03: (sim, rng, day) => {
    sim.stayUntil(at(sim, day, '05:30'));
    sim.driveTo('CU-FOS');
    sim.stayUntil(at(sim, day, '08:05'));
    runTrips(sim, rng, { until: at(sim, day, '19:30'), next: 'DEP-MRS', maxVisits: 2 });
    sim.driveTo('DEP-MRS');
  },

  // S4: deliveries in the morning, Le Pontet workshop from ~13:30 to 16:20
  T05: (sim, rng, day) => {
    sim.stayUntil(at(sim, day, '06:30'));
    runTrips(sim, rng, { until: at(sim, day, '13:20'), next: 'WS-PONTET', maxVisits: 2 });
    sim.driveTo('WS-PONTET');
    sim.stayUntil(at(sim, day, '16:20'));
    sim.driveTo('DEP-AVI');
  },

  // S1: the previous night is spent at a rest area (long-haul typical day); S1 is a scheduled withdrawal
  T07: (sim, rng, day) => workday(sim, rng, day),

  // S5: preventive refuel at midday, then night in the car park of the DKV station in Orange
  T09: (sim, rng, day) => {
    sim.stayUntil(at(sim, day, '07:00'));
    runTrips(sim, rng, { until: at(sim, day, '12:30'), next: 'DEP-CAV', maxVisits: 2 });
    sim.refuelIfBelow(0.6);
    runTrips(sim, rng, { until: at(sim, day, '21:00'), next: 'ST-DKV-ORANGE', maxVisits: 2 });
    sim.driveTo('ST-DKV-ORANGE');
  },

  // S3: at Primeurs du Comtat (Carpentras) before 10:30, until 11:55
  T10: (sim, rng, day) => {
    sim.stayUntil(at(sim, day, '06:45'));
    runTrips(sim, rng, { until: at(sim, day, '10:30'), next: 'CU-CARPENTRAS', maxVisits: 2 });
    sim.driveTo('CU-CARPENTRAS');
    sim.stayUntil(at(sim, day, '11:55'));
    runTrips(sim, rng, { until: at(sim, day, '19:00'), next: 'DEP-CAV', maxVisits: 2, exclude: ['CU-CARPENTRAS'] });
    sim.driveTo('DEP-CAV');
  },

  // S8: evening delivery at the Alpilles dairy, until 19:55
  T11: (sim, rng, day) => {
    sim.stayUntil(at(sim, day, '07:00'));
    runTrips(sim, rng, { until: at(sim, day, '18:30'), next: 'CU-STREMY', maxVisits: 3 });
    sim.driveTo('CU-STREMY');
    sim.stayUntil(at(sim, day, '19:55'));
    sim.driveTo('DEP-CAV');
  },

  // S7: break at the Lançon-Provence rest area until 17:05
  T12: (sim, rng, day) => {
    sim.stayUntil(at(sim, day, '06:50'));
    runTrips(sim, rng, { until: at(sim, day, '15:45'), next: 'RA-LANCON', maxVisits: 3 });
    sim.driveTo('RA-LANCON');
    sim.stayUntil(at(sim, day, '17:05'));
    sim.driveTo('DEP-CAV');
  },
};

/**
 * Simulates a truck over the whole period. On Sunday, the truck stays put, except
 * on the day of its scenario (always a working day) and the day before a night-time episode at a rest area.
 */
export function simulateTruck(world: World, truck: TruckDef): TruckSim {
  const { cal } = world;
  const rng = createRng(world.seed, 'truck', truck.code);
  const sim = new TruckSim(truck, world, rng, {
    placeCode: truck.homeDepot,
    levelL: round(truck.tankCapacityL * rng.float(0.55, 0.9), 1),
    odometerKm: round(rng.float(90_000, 650_000), 1),
  });
  const restAreaNights = new Set<number>();
  const scriptDays = new Set(
    SCENARIOS.filter((event) => event.truck === truck.code).map((event) => cal.liveDay + event.dayOffset),
  );
  for (const event of [...SCENARIOS, ...HISTORY_EVENTS]) {
    const day = cal.liveDay + event.dayOffset;
    if (event.truck !== truck.code || day < 1) continue;
    if (event.placeType === 'rest_area' && event.time < '12:00') restAreaNights.add(day - 1);
    if (event.kind === 'drain') {
      sim.drains.push({
        start: cal.at(day, event.time),
        minutes: event.durationMin,
        liters: event.amountL,
        label: event.id,
      });
    }
  }
  for (let day = 0; day < cal.days; day++) {
    const scripted = scriptDays.has(day);
    const forced = restAreaNights.has(day);
    if (cal.weekday(day) === 0 && !scripted && !forced) continue;
    const script = scripted ? SCENARIO_SCRIPTS[truck.code] : undefined;
    if (script) script(sim, rng, day);
    else workday(sim, rng, day, forced ? { nightOnRestArea: true } : {});
    if (sim.t >= cal.dayStart(day + 1) - 60) {
      throw new Error(`${truck.code}: the day of ${cal.date(day)} runs over into the night`);
    }
  }
  sim.stayUntil(cal.endMin);
  return sim;
}
