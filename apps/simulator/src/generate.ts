// `simulator generate`: pure function seed → dataset, then serialisation.

import type {
  DriverMessageInput,
  FuelCardTransaction,
  TelemetryReading,
  VerdictCategory,
} from '@fleet/contracts';
import { MESSAGE_TEMPLATES } from './messages.ts';
import { simulateTruck } from './plans.ts';
import { createRng } from './rng.ts';
import {
  HISTORY_EVENTS,
  SCENARIOS,
  expectedDecision,
  type ScenarioDef,
} from './scenarios.ts';
import type { TruckSim } from './simulate.ts';
import { TIME_ZONE, buildCalendar, type Calendar } from './time.ts';
import { buildReference, buildWorld, type Reference, type World } from './world.ts';

export interface ActivityData {
  telemetry: TelemetryReading[];
  refuels: FuelCardTransaction[];
  messages: DriverMessageInput[];
}

export interface GroundTruthEvent {
  id: string;
  truck: string;
  truckId: string;
  plate: string;
  kind: ScenarioDef['kind'];
  at: string;
  localDate: string;
  localTime: string;
  durationMin: number;
  amountL: number;
  place: { id: string; name: string; type: string };
  situation: string;
  clues: string[];
  expectedCategory: VerdictCategory;
  acceptableCategories: VerdictCategory[];
  expectedDecision: ReturnType<typeof expectedDecision>;
  messageAt: string | null;
}

export interface GroundTruth {
  seed: number;
  timeZone: string;
  /** Simulated period (Paris local dates, bounds included). */
  period: { start: string; end: string };
  /** Demo day (`live`) = last day of the period. */
  demoDay: string;
  trucks: Record<string, { id: string; plate: string }>;
  scenarios: GroundTruthEvent[];
  historyEvents: GroundTruthEvent[];
}

export interface Dataset {
  seed: number;
  calendar: Calendar;
  world: World;
  reference: Reference;
  history: ActivityData;
  live: ActivityData;
  groundTruth: GroundTruth;
  /** Raw simulation (real levels, daily statistics), for the tests. */
  sims: TruckSim[];
}

export const FILES = {
  reference: 'reference.json',
  historyTelemetry: 'history-telemetry.ndjson',
  historyRefuels: 'history-refuels.json',
  historyMessages: 'history-messages.json',
  liveTelemetry: 'live-telemetry.ndjson',
  liveRefuels: 'live-refuels.json',
  liveMessages: 'live-messages.json',
  groundTruth: 'ground-truth.json',
} as const;

/** Sensor artefact: the readings in [start, start + duration[ are skewed by −amountL. */
const eventDay = (cal: Calendar, event: ScenarioDef) => cal.liveDay + event.dayOffset;

function applySensorArtifact(sim: TruckSim, event: ScenarioDef): void {
  const start = sim.world.cal.at(eventDay(sim.world.cal, event), event.time);
  for (const reading of sim.readings) {
    if (reading.minute >= start && reading.minute < start + event.durationMin) {
      reading.fuelLevelL = Math.max(0, Math.round((reading.fuelLevelL - event.amountL) * 10) / 10);
    }
  }
}

/** The truck must be stopped at the right place type during the whole episode (± 20 min). */
function scenarioPlace(world: World, sim: TruckSim, event: ScenarioDef) {
  const day = eventDay(world.cal, event);
  const start = world.cal.at(day, event.time);
  const stay = sim.stayAt(start - 20);
  const place = stay ? world.place(stay.placeCode) : undefined;
  if (!stay || !place || stay.end < start + event.durationMin + 20 || place.type !== event.placeType) {
    throw new Error(
      `${event.id}: ${event.truck} is not stopped at a "${event.placeType}" place around ${event.time} on ${world.cal.date(day)}` +
        (stay ? ` (stop "${stay.placeCode}")` : ''),
    );
  }
  return place;
}

function buildMessages(world: World, sims: TruckSim[]): { minute: number; message: DriverMessageInput }[] {
  const { cal } = world;
  const out: { minute: number; message: DriverMessageInput }[] = [];
  const used = new Set<string>();
  const add = (truckCode: string, minute: number, body: string) => {
    const driver = world.driverOf(truckCode, cal.dayOf(minute));
    let sent = minute;
    while (used.has(`${driver.code}:${sent}`)) sent++;
    used.add(`${driver.code}:${sent}`);
    out.push({
      minute: sent,
      message: {
        driverId: world.id('driver', driver.code),
        truckId: world.id('truck', truckCode),
        sentAt: cal.toIso(sent),
        body,
      },
    });
  };

  // Scenario messages first (they take priority on the minute)
  for (const event of SCENARIOS) {
    if (!event.message) continue;
    const day = eventDay(cal, event);
    add(event.truck, cal.at(day, event.message.time), event.message.body(world.driverOf(event.truck, day)));
  }

  // 1 or 2 everyday messages per working day and per driver, depending on the truck's situation
  for (const sim of sims) {
    const rng = createRng(world.seed, 'messages', sim.truck.code);
    for (let day = 0; day < cal.days; day++) {
      if (cal.weekday(day) === 0 && day !== cal.liveDay) continue;
      const count = rng.int(1, 2);
      for (let i = 0; i < count; i++) {
        const minute = cal.at(day, '07:00') + rng.int(0, 12 * 60);
        const stay = sim.stayAt(minute);
        const templates = MESSAGE_TEMPLATES[stay ? world.place(stay.placeCode).type : 'driving'];
        add(sim.truck.code, minute, rng.pick(templates));
      }
    }
  }
  return out.sort((a, b) => a.minute - b.minute || a.message.truckId.localeCompare(b.message.truckId));
}

/**
 * Generates the period [today − 1 month; today] (Paris dates), `today` being the demo day.
 * Deterministic: same seed and same date → same files.
 */
export function generate(seed: number, today: string): Dataset {
  const cal = buildCalendar(today);
  const world = buildWorld(seed, cal);
  const sims = world.trucks.map((truck) => simulateTruck(world, truck));
  const simOf = (code: string) => sims.find((sim) => sim.truck.code === code)!;

  const events = [...SCENARIOS, ...HISTORY_EVENTS];
  for (const event of events) {
    if (event.kind === 'sensor_artifact') applySensorArtifact(simOf(event.truck), event);
  }

  const truthOf = (event: ScenarioDef): GroundTruthEvent => {
    const sim = simOf(event.truck);
    const place = scenarioPlace(world, sim, event);
    const day = eventDay(cal, event);
    const start = cal.at(day, event.time);
    if (event.clues.includes('no refuel') && sim.refuels.some((r) => Math.abs(r.minute - start) < 120)) {
      throw new Error(`${event.id}: a refuel happens less than 2 h from the episode`);
    }
    return {
      id: event.id,
      truck: event.truck,
      truckId: world.id('truck', event.truck),
      plate: sim.truck.plate,
      kind: event.kind,
      at: cal.toIso(start),
      localDate: cal.date(day),
      localTime: event.time,
      durationMin: event.durationMin,
      amountL: event.amountL,
      place: { id: world.id('place', place.code), name: place.name, type: place.type },
      situation: event.situation,
      clues: event.clues,
      expectedCategory: event.expectedCategory,
      acceptableCategories: event.acceptableCategories,
      expectedDecision: expectedDecision(event.expectedCategory),
      messageAt: event.message ? cal.toIso(cal.at(day, event.message.time)) : null,
    };
  };

  const telemetry = sims
    .flatMap((sim) =>
      sim.readings.map((r) => ({
        minute: r.minute,
        reading: {
          truckId: world.id('truck', sim.truck.code),
          recordedAt: cal.toIso(r.minute),
          lat: r.lat,
          lon: r.lon,
          speedKmh: r.speedKmh,
          ignition: r.ignition,
          fuelLevelL: r.fuelLevelL,
          odometerKm: r.odometerKm,
        } satisfies TelemetryReading,
      })),
    )
    .sort((a, b) => a.minute - b.minute || a.reading.truckId.localeCompare(b.reading.truckId));

  const refuels = sims
    .flatMap((sim) =>
      sim.refuels.map((r) => ({
        minute: r.minute,
        refuel: {
          truckId: world.id('truck', sim.truck.code),
          occurredAt: cal.toIso(r.minute),
          placeId: world.id('place', r.placeCode),
          liters: r.liters,
          unitPriceEur: r.unitPriceEur,
          totalEur: r.totalEur,
        } satisfies FuelCardTransaction,
      })),
    )
    .sort((a, b) => a.minute - b.minute || a.refuel.truckId.localeCompare(b.refuel.truckId));

  const messages = buildMessages(world, sims);
  const isLive = (item: { minute: number }) => item.minute >= cal.liveStartMin;
  const split = (live: boolean): ActivityData => ({
    telemetry: telemetry.filter((x) => isLive(x) === live).map((x) => x.reading),
    refuels: refuels.filter((x) => isLive(x) === live).map((x) => x.refuel),
    messages: messages.filter((x) => isLive(x) === live).map((x) => x.message),
  });

  return {
    seed,
    calendar: cal,
    world,
    reference: buildReference(world),
    history: split(false),
    live: split(true),
    groundTruth: {
      seed,
      timeZone: TIME_ZONE,
      period: { start: cal.startDate, end: cal.demoDate },
      demoDay: cal.demoDate,
      trucks: Object.fromEntries(
        world.trucks.map((t) => [t.code, { id: world.id('truck', t.code), plate: t.plate }]),
      ),
      scenarios: SCENARIOS.map(truthOf),
      historyEvents: HISTORY_EVENTS.map(truthOf),
    },
    sims,
  };
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const ndjson = (items: readonly unknown[]) => items.map((item) => `${JSON.stringify(item)}\n`).join('');

/** Content of the `data/generated/` files, indexed by file name. */
export function serialize(dataset: Dataset): Record<string, string> {
  return {
    [FILES.reference]: json(dataset.reference),
    [FILES.historyTelemetry]: ndjson(dataset.history.telemetry),
    [FILES.historyRefuels]: json(dataset.history.refuels),
    [FILES.historyMessages]: json(dataset.history.messages),
    [FILES.liveTelemetry]: ndjson(dataset.live.telemetry),
    [FILES.liveRefuels]: json(dataset.live.refuels),
    [FILES.liveMessages]: json(dataset.live.messages),
    [FILES.groundTruth]: json(dataset.groundTruth),
  };
}
