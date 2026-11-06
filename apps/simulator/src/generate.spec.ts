import { createHash } from 'node:crypto';
import {
  DriverMessageInput,
  FuelCardTransaction,
  HistoryLoadBatch,
  TelemetryReading,
} from '@fleet/contracts';
import { beforeAll, describe, expect, it } from 'vitest';
// Règle du détecteur de l'API, appliquée telle quelle aux fichiers générés (critère 4)
import {
  DEDUP_WINDOW_MS,
  DETECTION_WINDOW_MS,
  evaluateFuelDrop,
  type RuleReading,
} from '../../nestjs/src/detector/fuel-drop.rule.ts';
import { generate, serialize, type Dataset } from './generate.ts';
import { addDays } from './time.ts';

const FUEL_DROP_MIN_L = 40;
/** Date d'exécution figée : la période (06/10 → 06/11/2026) contient le passage à l'heure d'hiver du 25/10. */
const TODAY = '2026-11-06';

const fingerprint = (files: Record<string, string>) =>
  createHash('sha256').update(JSON.stringify(files)).digest('hex');

interface DetectedAlert {
  truckId: string;
  windowStart: number;
  windowEnd: number;
  dropL: number;
}

/** Rejoue le détecteur (règle + anti-doublon de 30 min) sur les relevés `live`, dans l'ordre. */
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

  it('1. même graine et même date → fichiers identiques ; autre graine → fichiers différents', () => {
    const first = fingerprint(serialize(dataset));
    expect(fingerprint(serialize(generate(42, TODAY)))).toBe(first);
    expect(fingerprint(serialize(generate(43, TODAY)))).not.toBe(first);
  });

  it("simule un mois jusqu'à la date d'exécution, la journée de démo étant ce jour-là", () => {
    const { groundTruth, calendar } = dataset;
    expect(groundTruth.period).toEqual({ start: '2026-10-06', end: TODAY });
    expect(groundTruth.demoDay).toBe(TODAY);
    expect(calendar.days).toBe(32);
    // Premier relevé à minuit heure de Paris (UTC+2), dernier à 23:55 le jour J (UTC+1)
    expect(dataset.history.telemetry[0].recordedAt).toBe('2026-10-05T22:00:00.000Z');
    expect(dataset.live.telemetry[0].recordedAt).toBe('2026-11-05T23:00:00.000Z');
    expect(dataset.live.telemetry.at(-1)!.recordedAt).toBe('2026-11-06T22:55:00.000Z');
    for (const scenario of groundTruth.scenarios) expect(scenario.localDate).toBe(TODAY);
  });

  it('les données respectent les contrats', () => {
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

  it('un relevé toutes les 5 minutes par camion, sans trou ni doublon au changement d’heure', () => {
    // 31 jours d'historique dont le 25/10 de 25 h
    expect(dataset.history.telemetry).toHaveLength(12 * (31 * 288 + 12));
    expect(dataset.live.telemetry).toHaveLength(12 * 288);
    const instants = dataset.history.telemetry.map((r) => Date.parse(r.recordedAt));
    for (let i = 12; i < instants.length; i += 12) expect(instants[i] - instants[i - 12]).toBe(5 * 60_000);
  });

  it('2. niveaux dans [0, capacité], odomètre croissant', () => {
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

  it('2. les pleins ont lieu en station, camion arrêté sur place', () => {
    const refuels = dataset.sims.flatMap((sim) => sim.refuels.map((refuel) => ({ sim, refuel })));
    expect(refuels.length).toBeGreaterThan(20);
    for (const { sim, refuel } of refuels) {
      expect(dataset.world.place(refuel.placeCode).type).toBe('fuel_station');
      expect(sim.stayAt(refuel.minute)?.placeCode).toBe(refuel.placeCode);
      expect(refuel.unitPriceEur).toBeGreaterThanOrEqual(1.62);
      expect(refuel.unitPriceEur).toBeLessThanOrEqual(1.78);
    }
  });

  it('2. consommation mesurée de chaque journée à ± 10 % de la consommation attendue', () => {
    let checked = 0;
    const cal = dataset.calendar;
    for (const sim of dataset.sims) {
      for (let day = 0; day < cal.days; day++) {
        const stats = sim.dayStats[day];
        const expected =
          (stats.km * sim.truck.baselineLPer100km) / 100 + (stats.idleMin * sim.truck.idleLPerHour) / 60;
        if (expected < 80) continue; // jours sans trajet notable : le bruit de sonde domine
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

  it('3 et 4. le détecteur ne lève que les alertes des scénarios S1-S8, au bon camion, à la bonne heure, avec la bonne amplitude', () => {
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

  it('3. les artefacts de sonde remontent dans les 10 minutes', () => {
    for (const scenario of dataset.groundTruth.scenarios.filter((s) => s.kind === 'sensor_artifact')) {
      const readings = dataset.live.telemetry.filter((r) => r.truckId === scenario.truckId);
      const level = (offsetMin: number) =>
        readings.find((r) => Date.parse(r.recordedAt) === Date.parse(scenario.at) + offsetMin * 60_000)!
          .fuelLevelL;
      const recovery = level(scenario.durationMin) - level(scenario.durationMin - 5);
      expect(Math.abs(recovery - scenario.amountL), `${scenario.id} : +${recovery} L`).toBeLessThanOrEqual(5);
    }
  });

  it("l'historique contient les deux chutes nocturnes de T07 sur des aires", () => {
    const events = dataset.groundTruth.historyEvents;
    expect(events.map((e) => [e.truck, e.localDate, e.amountL, e.place.type])).toEqual([
      ['T07', addDays(TODAY, -11), 55, 'rest_area'],
      ['T07', addDays(TODAY, -5), 60, 'rest_area'],
    ]);
  });

  it('les messages des scénarios sont présents ; S4 contient un nom et un téléphone de mécanicien', () => {
    const s4 = dataset.groundTruth.scenarios.find((s) => s.id === 'S4-workshop')!;
    const message = dataset.live.messages.find((m) => m.sentAt === s4.messageAt);
    expect(message?.body).toMatch(/Marc Lefèvre, 06 39 98 77 05/);
    for (const scenario of dataset.groundTruth.scenarios) {
      if (scenario.messageAt) {
        expect(dataset.live.messages.some((m) => m.sentAt === scenario.messageAt && m.truckId === scenario.truckId)).toBe(true);
      }
    }
  });

  it('aucun plein autour des épisodes S1 et S5', () => {
    for (const id of ['S1-theft', 'S5-ambiguous']) {
      const scenario = dataset.groundTruth.scenarios.find((s) => s.id === id)!;
      const near = dataset.live.refuels.filter(
        (r) => r.truckId === scenario.truckId && Math.abs(Date.parse(r.occurredAt) - Date.parse(scenario.at)) < 2 * 3_600_000,
      );
      expect(near, id).toEqual([]);
    }
  });

  // Quelle que soit la date d'exécution : lundi (veille = dimanche), dimanche, passage à l'heure d'été, 31 mars
  it.each([
    [42, '2026-11-09'],
    [42, '2026-11-08'],
    [42, '2026-03-31'],
    [1, '2027-01-15'],
    [7, '2026-11-06'],
    [2026, '2026-06-20'],
  ])('la génération reste valide (graine %i, exécution le %s)', (seed, today) => {
    const other = generate(seed, today);
    const alerts = detect(other);
    expect(alerts).toHaveLength(other.groundTruth.scenarios.length);
    expect(other.groundTruth.scenarios.every((s) => s.localDate === today)).toBe(true);
  });
});
