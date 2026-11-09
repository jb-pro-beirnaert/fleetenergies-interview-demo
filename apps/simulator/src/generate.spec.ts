import { createHash } from 'node:crypto';
import {
  DriverMessageInput,
  FuelCardTransaction,
  HistoryLoadBatch,
  InvoiceExtraction,
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
import { B2_INVOICE_COUNT, BILLING_SCENARIOS } from './billing.ts';
import { FILES, generate, serialize, type Dataset } from './generate.ts';
import { addDays } from './time.ts';

const FUEL_DROP_MIN_L = 40;
/** Frozen run date (Friday 06/11/2026); the history (from 06/10) contains the switch to winter time on 25/10. */
const TODAY = '2026-11-06';
/** Frozen start instant: 10:02 Paris time → demo week from 10:05 on 06/11 to 10:05 on 13/11. */
const START = Date.parse('2026-11-06T09:02:00Z');
const WEEK_MS = 7 * 24 * 3_600_000;

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
    dataset = generate(42, START);
  });

  it('1. same seed and same start instant → identical files; other seed → different files', () => {
    const first = fingerprint(serialize(dataset));
    expect(fingerprint(serialize(generate(42, START)))).toBe(first);
    expect(fingerprint(serialize(generate(43, START)))).not.toBe(first);
  });

  it('simulates one month of history, then one week from the start instant', () => {
    const { groundTruth, calendar } = dataset;
    expect(groundTruth.period).toEqual({ start: '2026-10-06', end: '2026-11-13' });
    expect(groundTruth.live).toEqual({ start: '2026-11-06T09:05:00.000Z', end: '2026-11-13T09:05:00.000Z' });
    expect(calendar.demoDate).toBe(TODAY);
    expect(calendar.days).toBe(39);
    // First reading at midnight Paris time (UTC+2); the history stops right before the start
    expect(dataset.history.telemetry[0].recordedAt).toBe('2026-10-05T22:00:00.000Z');
    expect(dataset.history.telemetry.at(-1)!.recordedAt).toBe('2026-11-06T09:00:00.000Z');
    expect(dataset.live.telemetry[0].recordedAt).toBe('2026-11-06T09:05:00.000Z');
    expect(dataset.live.telemetry.at(-1)!.recordedAt).toBe('2026-11-13T09:05:00.000Z');
    // Scenarios spread over D + 1 … D + 6, all within the demo week
    expect(groundTruth.scenarios.map((s) => s.localDate).sort()).toEqual(
      [1, 1, 2, 3, 4, 5, 5, 6].map((offset) => addDays(TODAY, offset)),
    );
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
    // 31 days of history including the 25-hour 25/10, plus 00:00 → 10:00 on D; then one week inclusive
    expect(dataset.history.telemetry).toHaveLength(12 * (31 * 288 + 12 + 121));
    expect(dataset.live.telemetry).toHaveLength(12 * (7 * 288 + 1));
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
      ['T07', addDays(TODAY, -9), 55, 'rest_area'],
      ['T07', addDays(TODAY, -3), 60, 'rest_area'],
    ]);
    // 11 and 5 days before S1 (D + 2)
    const s1 = dataset.groundTruth.scenarios.find((s) => s.id === 'S1-theft')!;
    expect(s1.localDate).toBe(addDays(TODAY, 2));
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

  describe('V2 — invoices', () => {
    const invoice = (id: string) => dataset.groundTruth.invoices.find((i) => i.id === id)!;

    it('B1, B3 and B4 are invoiced on their scripted refuel, at the planned station and time', () => {
      for (const event of BILLING_SCENARIOS) {
        const truth = invoice(event.id);
        expect(truth.truck, event.id).toBe(event.truck);
        const planned = dataset.calendar.at(dataset.calendar.liveDay + event.dayOffset, event.time);
        expect(Math.abs(dataset.calendar.fromIso(truth.refuelAt) - planned), event.id).toBeLessThanOrEqual(10);
        expect(truth.expected.stationName).toBe(dataset.world.place(event.station).name);
        expect(truth.deliveredL).toBeGreaterThan(0);
        expect(truth.deliveredL).toBeLessThanOrEqual(event.liters);
        expect(truth.expectedStatus).toBe(event.expectedStatus);
      }
      // With the frozen start, the planned liters fit in the tank
      expect(invoice('B1-overbilled')).toMatchObject({ deliveredL: 250, billedL: 412, template: 'as24' });
      expect(invoice('B3-injection')).toMatchObject({ deliveredL: 210, template: 'totalenergies' });
      expect(invoice('B4-messy')).toMatchObject({ deliveredL: 180, template: 'independent' });
    });

    it('B1 is overbilled beyond the reconciliation tolerance; every other invoice bills what was delivered', () => {
      for (const truth of dataset.groundTruth.invoices) {
        const gap = truth.billedL - truth.deliveredL;
        if (truth.id === 'B1-overbilled') {
          expect(gap).toBeGreaterThan(Math.max(20, 0.08 * truth.billedL));
          expect(truth.expectedCategory).toBe('billing_discrepancy');
        } else {
          expect(gap, truth.id).toBe(0);
          expect(truth.expectedStatus, truth.id).toBe('matched');
        }
      }
    });

    it('B2: ordinary invoices spread over the templates; the 4 templates are used', () => {
      const b2 = dataset.groundTruth.invoices.filter((i) => i.scenario === 'B2-normal');
      expect(b2).toHaveLength(B2_INVOICE_COUNT);
      expect(new Set(dataset.groundTruth.invoices.map((i) => i.template))).toEqual(
        new Set(['as24', 'totalenergies', 'dkv', 'independent']),
      );
    });

    it('each invoice matches a card transaction of the week and is sent 30 min later, before the end of the week', () => {
      const liveEnd = Date.parse(dataset.groundTruth.live.end);
      for (const plan of dataset.invoices) {
        expect(dataset.live.refuels).toContainEqual(plan.refuel);
        expect(Date.parse(plan.receivedAt) - Date.parse(plan.refuel.occurredAt)).toBe(30 * 60_000);
        expect(Date.parse(plan.receivedAt)).toBeLessThanOrEqual(liveEnd);
      }
    });

    it('the expected values comply with the contract and with the API consistency rules', () => {
      for (const truth of dataset.groundTruth.invoices) {
        const expected = InvoiceExtraction.parse(truth.expected);
        expect(expected.plate).toMatch(/^[A-Z]{2}-\d{3}-[A-Z]{2}$/);
        expect(expected.liters).toBeGreaterThanOrEqual(1);
        expect(expected.liters).toBeLessThanOrEqual(1_200);
        const computed = expected.liters! * expected.unitPriceEur!;
        expect(Math.abs(computed - expected.totalEur!) / expected.totalEur!).toBeLessThanOrEqual(0.02);
        expect(expected.suspiciousContent).toBe(truth.id === 'B3-injection');
      }
    });

    it('`invoices-plan.json` is part of the generated files', () => {
      const plan = JSON.parse(serialize(dataset)[FILES.invoicesPlan]);
      expect(plan).toHaveLength(dataset.invoices.length);
    });
  });

  // Whatever the start instant: Monday morning, Sunday just before midnight, a week crossing the switch
  // to summer time, 31 March, just after midnight, in the middle of the night
  it.each([
    [42, '2026-11-09T07:00:00Z'],
    [42, '2026-11-08T22:58:00Z'],
    [42, '2026-03-26T13:37:00Z'],
    [42, '2026-03-31T09:00:00Z'],
    [1, '2027-01-15T23:01:00Z'],
    [7, '2026-11-06T16:44:00Z'],
    [2026, '2026-06-20T01:30:00Z'],
  ])('the generation stays valid (seed %i, start at %s)', (seed, startIso) => {
    const start = Date.parse(startIso);
    const other = generate(seed, start);
    const alerts = detect(other);
    expect(alerts).toHaveLength(other.groundTruth.scenarios.length);
    const live = other.groundTruth.live;
    expect(Date.parse(live.end) - Date.parse(live.start)).toBe(WEEK_MS);
    expect(Date.parse(live.start) - start).toBeGreaterThanOrEqual(0);
    expect(Date.parse(live.start) - start).toBeLessThan(5 * 60_000);
    for (const scenario of other.groundTruth.scenarios) {
      expect(Date.parse(scenario.at)).toBeGreaterThan(Date.parse(live.start));
      expect(Date.parse(scenario.at)).toBeLessThan(Date.parse(live.end));
    }
    // V2: the three scripted invoices are always there, B1 always overbilled
    const ids = other.groundTruth.invoices.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(BILLING_SCENARIOS.map((event) => event.id)));
    const b1 = other.groundTruth.invoices.find((i) => i.id === 'B1-overbilled')!;
    expect(b1.billedL - b1.deliveredL).toBe(162);
  });
});
