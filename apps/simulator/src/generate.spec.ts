import { createHash } from 'node:crypto';
import {
  DriverMessageInput,
  FuelCardTransaction,
  HistoryLoadBatch,
  TelemetryReading,
} from '@fleet/contracts';
import { beforeAll, describe, expect, it } from 'vitest';
// The API detector rule, applied as is to the generated files (criterion 4)
import {
  DEDUP_WINDOW_MS,
  DETECTION_WINDOW_MS,
  evaluateFuelDrop,
  type RuleReading,
} from '../../nestjs/src/detector/fuel-drop.rule.ts';
import { generate, serialize, type Dataset } from './generate.ts';
import { addDays } from './time.ts';

const FUEL_DROP_MIN_L = 40;
/** Frozen run date: the period (06/10 → 06/11/2026) contains the switch to winter time on 25/10. */
const TODAY = '2026-11-06';

const fingerprint = (files: Record<string, string>) =>
  createHash('sha256').update(JSON.stringify(files)).digest('hex');

interface DetectedAlert {
  truckId: string;
  windowStart: number;
  windowEnd: number;
  dropL: number;
}

/** Replays the detector (rule + 30-min anti-duplicate) on the `live` readings, in order. */
function detect(dataset: Dataset): DetectedAlert[] {
  const all = [...dataset.history.telemetry, ...dataset.live.telemetry];
  const alerts: DetectedAlert[] = [];
  for (const [truckId, readings] of Map.groupBy(all, (r) => r.truckId)) {
    const rule: RuleReading[] = readings
      .map((r) => ({ ...r, recordedAt: new Date(r.recordedAt) }))
      .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
    const own: DetectedAlert[] = [];
    rule.forEach((reading, index) => {
      if (dataset.calendar.fromIso(reading.recordedAt.toISOString()) < dataset.calendar.liveStartMin) return;
      const now = reading.recordedAt.getTime();
      const window = rule
        .slice(Math.max(0, index - 10), index + 1)
        .filter((r) => r.recordedAt.getTime() >= now - DETECTION_WINDOW_MS);
      const anomaly = evaluateFuelDrop(window, FUEL_DROP_MIN_L);
      if (!anomaly) return;
      const existing = own.findLast((a) => a.windowEnd >= now - DEDUP_WINDOW_MS);
      if (existing) {
        const first = rule.find((r) => r.recordedAt.getTime() >= existing.windowStart)!;
        existing.windowEnd = now;
        existing.dropL = Math.max(existing.dropL, first.fuelLevelL - reading.fuelLevelL);
      } else {
        own.push({ truckId, windowStart: anomaly.startAt.getTime(), windowEnd: now, dropL: anomaly.dropL });
      }
    });
    alerts.push(...own);
  }
  return alerts;
}

describe('simulator generate', () => {
  let dataset: Dataset;
  beforeAll(() => {
    dataset = generate(42, TODAY);
  });

  it('1. same seed and same date → identical files; other seed → different files', () => {
    const first = fingerprint(serialize(dataset));
    expect(fingerprint(serialize(generate(42, TODAY)))).toBe(first);
    expect(fingerprint(serialize(generate(43, TODAY)))).not.toBe(first);
  });

  it('simulates one month up to the run date, the demo day being that day', () => {
    const { groundTruth, calendar } = dataset;
    expect(groundTruth.period).toEqual({ start: '2026-10-06', end: TODAY });
    expect(groundTruth.demoDay).toBe(TODAY);
    expect(calendar.days).toBe(32);
    // First reading at midnight Paris time (UTC+2), last one at 23:55 on day D (UTC+1)
    expect(dataset.history.telemetry[0].recordedAt).toBe('2026-10-05T22:00:00.000Z');
    expect(dataset.live.telemetry[0].recordedAt).toBe('2026-11-05T23:00:00.000Z');
    expect(dataset.live.telemetry.at(-1)!.recordedAt).toBe('2026-11-06T22:55:00.000Z');
    for (const scenario of groundTruth.scenarios) expect(scenario.localDate).toBe(TODAY);
  });

  it('the data complies with the contracts', () => {
    const { reference, history, live } = dataset;
    expect(() => HistoryLoadBatch.parse(reference)).not.toThrow();
    for (const data of [history, live]) {
      for (const reading of data.telemetry) TelemetryReading.parse(reading);
      for (const refuel of data.refuels) FuelCardTransaction.parse(refuel);
      for (const message of data.messages) DriverMessageInput.parse(message);
    }
    expect(reference.places).toHaveLength(25);
    expect(reference.trucks).toHaveLength(12);
    expect(reference.drivers).toHaveLength(14);
  });

  it('one reading every 5 minutes per truck, without gap or duplicate at the time change', () => {
    // 31 days of history including the 25-hour 25/10
    expect(dataset.history.telemetry).toHaveLength(12 * (31 * 288 + 12));
    expect(dataset.live.telemetry).toHaveLength(12 * 288);
    const instants = dataset.history.telemetry.map((r) => Date.parse(r.recordedAt));
    for (let i = 12; i < instants.length; i += 12) expect(instants[i] - instants[i - 12]).toBe(5 * 60_000);
  });

  it('2. levels within [0, capacity], increasing odometer', () => {
    for (const sim of dataset.sims) {
      let odometer = 0;
      for (const reading of sim.readings) {
        expect(reading.fuelLevelL).toBeGreaterThanOrEqual(0);
        expect(reading.fuelLevelL).toBeLessThanOrEqual(sim.truck.tankCapacityL);
        expect(reading.trueLevelL).toBeGreaterThanOrEqual(0);
        expect(reading.trueLevelL).toBeLessThanOrEqual(sim.truck.tankCapacityL);
        expect(reading.odometerKm).toBeGreaterThanOrEqual(odometer);
        odometer = reading.odometerKm;
      }
    }
  });

  it('2. refuels happen at fuel stations, with the truck stopped there', () => {
    const refuels = dataset.sims.flatMap((sim) => sim.refuels.map((refuel) => ({ sim, refuel })));
    expect(refuels.length).toBeGreaterThan(20);
    for (const { sim, refuel } of refuels) {
      expect(dataset.world.place(refuel.placeCode).type).toBe('fuel_station');
      expect(sim.stayAt(refuel.minute)?.placeCode).toBe(refuel.placeCode);
      expect(refuel.unitPriceEur).toBeGreaterThanOrEqual(1.62);
      expect(refuel.unitPriceEur).toBeLessThanOrEqual(1.78);
    }
  });

  it('2. measured consumption of each day within ± 10% of the expected consumption', () => {
    let checked = 0;
    const cal = dataset.calendar;
    for (const sim of dataset.sims) {
      for (let day = 0; day < cal.days; day++) {
        const stats = sim.dayStats[day];
        const expected =
          (stats.km * sim.truck.baselineLPer100km) / 100 + (stats.idleMin * sim.truck.idleLPerHour) / 60;
        if (expected < 80) continue; // days without a significant trip: sensor noise dominates
        const readings = sim.readings.filter((r) => cal.dayOf(r.minute) === day);
        const refueled = sim.refuels
          .filter((r) => cal.dayOf(r.minute) === day)
          .reduce((sum, r) => sum + r.liters, 0);
        const measured =
          readings[0].fuelLevelL - readings.at(-1)!.fuelLevelL + refueled - stats.drainedL;
        expect(Math.abs(measured - expected) / expected, `${sim.truck.code} jour ${day}`).toBeLessThanOrEqual(0.1);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(120);
  });

  it('3 and 4. the detector only raises the alerts of scenarios S1-S8, on the right truck, at the right time, with the right amplitude', () => {
    const alerts = detect(dataset);
    const scenarios = dataset.groundTruth.scenarios;
    expect(alerts).toHaveLength(scenarios.length);
    for (const scenario of scenarios) {
      const start = Date.parse(scenario.at);
      const alert = alerts.find(
        (a) =>
          a.truckId === scenario.truckId &&
          start >= a.windowStart - 10 * 60_000 &&
          start <= a.windowEnd + 10 * 60_000,
      );
      expect(alert, scenario.id).toBeDefined();
      expect(Math.abs(alert!.dropL - scenario.amountL), `${scenario.id} : ${alert!.dropL} L`).toBeLessThanOrEqual(5);
    }
  });

  it('3. sensor artefacts go back up within 10 minutes', () => {
    for (const scenario of dataset.groundTruth.scenarios.filter((s) => s.kind === 'sensor_artifact')) {
      const readings = dataset.live.telemetry.filter((r) => r.truckId === scenario.truckId);
      const level = (offsetMin: number) =>
        readings.find((r) => Date.parse(r.recordedAt) === Date.parse(scenario.at) + offsetMin * 60_000)!
          .fuelLevelL;
      const recovery = level(scenario.durationMin) - level(scenario.durationMin - 5);
      expect(Math.abs(recovery - scenario.amountL), `${scenario.id} : +${recovery} L`).toBeLessThanOrEqual(5);
    }
  });

  it('the history contains the two night-time drops of T07 at rest areas', () => {
    const events = dataset.groundTruth.historyEvents;
    expect(events.map((e) => [e.truck, e.localDate, e.amountL, e.place.type])).toEqual([
      ['T07', addDays(TODAY, -11), 55, 'rest_area'],
      ['T07', addDays(TODAY, -5), 60, 'rest_area'],
    ]);
  });

  it('the scenario messages are present; S4 contains a mechanic name and phone number', () => {
    const s4 = dataset.groundTruth.scenarios.find((s) => s.id === 'S4-workshop')!;
    const message = dataset.live.messages.find((m) => m.sentAt === s4.messageAt);
    expect(message?.body).toMatch(/Marc Lefèvre, 06 39 98 77 05/);
    for (const scenario of dataset.groundTruth.scenarios) {
      if (scenario.messageAt) {
        expect(dataset.live.messages.some((m) => m.sentAt === scenario.messageAt && m.truckId === scenario.truckId)).toBe(true);
      }
    }
  });

  it('no refuel around episodes S1 and S5', () => {
    for (const id of ['S1-theft', 'S5-ambiguous']) {
      const scenario = dataset.groundTruth.scenarios.find((s) => s.id === id)!;
      const near = dataset.live.refuels.filter(
        (r) => r.truckId === scenario.truckId && Math.abs(Date.parse(r.occurredAt) - Date.parse(scenario.at)) < 2 * 3_600_000,
      );
      expect(near, id).toEqual([]);
    }
  });

  // Whatever the run date: Monday (day before = Sunday), Sunday, switch to summer time, 31 March
  it.each([
    [42, '2026-11-09'],
    [42, '2026-11-08'],
    [42, '2026-03-31'],
    [1, '2027-01-15'],
    [7, '2026-11-06'],
    [2026, '2026-06-20'],
  ])('the generation stays valid (seed %i, run on %s)', (seed, today) => {
    const other = generate(seed, today);
    const alerts = detect(other);
    expect(alerts).toHaveLength(other.groundTruth.scenarios.length);
    expect(other.groundTruth.scenarios.every((s) => s.localDate === today)).toBe(true);
  });
});
