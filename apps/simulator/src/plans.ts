// Plans de journée : journée type tirée au hasard, et journées scriptées des camions
// des scénarios le 14/10 (le camion doit être arrêté au bon type de lieu à l'heure prévue).

import { roadKm } from './geo.ts';
import { createRng, round, type Rng } from './rng.ts';
import { HISTORY_EVENTS, SCENARIOS } from './scenarios.ts';
import { TruckSim } from './simulate.ts';
import type { TruckDef, World } from './world.ts';

type DayPlan = (sim: TruckSim, rng: Rng, day: number) => void;

/** Minute d'une heure locale de Paris pour un jour simulé. */
const at = (sim: TruckSim, day: number, hhmm: string): number => sim.world.cal.at(day, hhmm);

/** Marge de planification pour absorber un éventuel détour par une station. */
const SLACK_MIN = 25;

interface TripOptions {
  /** Heure limite d'arrivée à `next`. */
  until: number;
  /** Lieu à rejoindre après les livraisons. */
  next: string;
  maxVisits: number;
  exclude?: readonly string[];
}

/** Enchaîne des livraisons tant qu'il reste le temps de rejoindre `next` avant `until`. */
export function runTrips(sim: TruckSim, rng: Rng, options: TripOptions): void {
  for (let visit = 0; visit < options.maxVisits; visit++) {
    const here = sim.placeCode;
    if (!here) throw new Error(`${sim.truck.code} : livraison hors de tout lieu`);
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
 * Journée type : départ entre 05:30 et 07:30, 1 à 3 livraisons, retour au dépôt ;
 * nuit sur l'aire la plus proche pour un camion longue distance (sauf le samedi),
 * ou quand `nightOnRestArea` l'impose (veille d'un épisode nocturne sur une aire).
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

/** Journées scriptées du 14/10 (un script par camion de scénario). */
const LIVE_SCRIPTS: Record<string, DayPlan> = {
  // S6 : artefact au dépôt à 05:50, départ ensuite
  T01: (sim, rng, day) => workday(sim, rng, day, { departAt: at(sim, day, '06:35') }),

  // S2 : à quai chez le client de Fos de ~06:30 à 08:05
  T03: (sim, rng, day) => {
    sim.stayUntil(at(sim, day, '05:30'));
    sim.driveTo('CU-FOS');
    sim.stayUntil(at(sim, day, '08:05'));
    runTrips(sim, rng, { until: at(sim, day, '19:30'), next: 'DEP-MRS', maxVisits: 2 });
    sim.driveTo('DEP-MRS');
  },

  // S4 : livraisons le matin, atelier du Pontet de ~13:30 à 16:20
  T05: (sim, rng, day) => {
    sim.stayUntil(at(sim, day, '06:30'));
    runTrips(sim, rng, { until: at(sim, day, '13:20'), next: 'WS-PONTET', maxVisits: 2 });
    sim.driveTo('WS-PONTET');
    sim.stayUntil(at(sim, day, '16:20'));
    sim.driveTo('DEP-AVI');
  },

  // S1 : la nuit précédente se passe sur une aire (journée type longue distance) ; S1 est un retrait programmé
  T07: (sim, rng, day) => workday(sim, rng, day),

  // S5 : plein préventif à la mi-journée, puis nuit sur le parking de la station DKV d'Orange
  T09: (sim, rng, day) => {
    sim.stayUntil(at(sim, day, '07:00'));
    runTrips(sim, rng, { until: at(sim, day, '12:30'), next: 'DEP-CAV', maxVisits: 2 });
    sim.refuelIfBelow(0.6);
    runTrips(sim, rng, { until: at(sim, day, '21:00'), next: 'ST-DKV-ORANGE', maxVisits: 2 });
    sim.driveTo('ST-DKV-ORANGE');
  },

  // S3 : chez Primeurs du Comtat (Carpentras) avant 10:30, jusqu'à 11:55
  T10: (sim, rng, day) => {
    sim.stayUntil(at(sim, day, '06:45'));
    runTrips(sim, rng, { until: at(sim, day, '10:30'), next: 'CU-CARPENTRAS', maxVisits: 2 });
    sim.driveTo('CU-CARPENTRAS');
    sim.stayUntil(at(sim, day, '11:55'));
    runTrips(sim, rng, { until: at(sim, day, '19:00'), next: 'DEP-CAV', maxVisits: 2, exclude: ['CU-CARPENTRAS'] });
    sim.driveTo('DEP-CAV');
  },

  // S8 : livraison du soir à la Laiterie des Alpilles, jusqu'à 19:55
  T11: (sim, rng, day) => {
    sim.stayUntil(at(sim, day, '07:00'));
    runTrips(sim, rng, { until: at(sim, day, '18:30'), next: 'CU-STREMY', maxVisits: 3 });
    sim.driveTo('CU-STREMY');
    sim.stayUntil(at(sim, day, '19:55'));
    sim.driveTo('DEP-CAV');
  },

  // S7 : pause sur l'aire de Lançon-Provence jusqu'à 17:05
  T12: (sim, rng, day) => {
    sim.stayUntil(at(sim, day, '06:50'));
    runTrips(sim, rng, { until: at(sim, day, '15:45'), next: 'RA-LANCON', maxVisits: 3 });
    sim.driveTo('RA-LANCON');
    sim.stayUntil(at(sim, day, '17:05'));
    sim.driveTo('DEP-CAV');
  },
};

/**
 * Simule un camion sur toute la période. Le dimanche, le camion reste sur place, sauf
 * la journée de démo (toujours travaillée) et la veille d'un épisode nocturne sur une aire.
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
    const live = day === cal.liveDay;
    const forced = restAreaNights.has(day);
    if (cal.weekday(day) === 0 && !live && !forced) continue;
    const script = live ? LIVE_SCRIPTS[truck.code] : undefined;
    if (script) script(sim, rng, day);
    else workday(sim, rng, day, forced ? { nightOnRestArea: true } : {});
    if (sim.t >= cal.dayStart(day + 1) - 60) {
      throw new Error(`${truck.code} : la journée du ${cal.date(day)} déborde sur la nuit`);
    }
  }
  sim.stayUntil(cal.endMin);
  return sim;
}
