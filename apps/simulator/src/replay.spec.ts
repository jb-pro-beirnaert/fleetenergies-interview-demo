import { describe, expect, it } from 'vitest';
import type { ActivityData } from './generate.ts';
import { planSteps } from './replay.ts';
import { localToUtcMs, parseHHMM } from './time.ts';

const DEMO_DAY = '2026-11-06';
const instant = (hhmm: string) => localToUtcMs(DEMO_DAY, parseHHMM(hhmm));
const iso = (hhmm: string) => new Date(instant(hhmm)).toISOString();
const TRUCK = '00000000-0000-4000-8000-000000000001';
const reading = (hhmm: string) => ({
  truckId: TRUCK, recordedAt: iso(hhmm), lat: 44, lon: 4.8, speedKmh: 0, ignition: false, fuelLevelL: 300, odometerKm: 1000,
});

describe('planSteps', () => {
  const live: ActivityData = {
    telemetry: ['01:55', '02:00', '02:05', '02:10', '23:35'].map(reading),
    refuels: [{ truckId: TRUCK, occurredAt: iso('02:07'), liters: 100 }],
    messages: [],
  };

  it('découpe en pas de 5 min, rattrape ce qui précède --from et ignore ce qui suit --to', () => {
    const steps = planSteps(live, instant('02:00'), instant('23:30'));
    expect(steps).toHaveLength(259);
    expect(steps[0].telemetry.map((r) => r.recordedAt)).toEqual([iso('01:55'), iso('02:00')]);
    expect(steps[1].telemetry).toHaveLength(1);
    // Un plein à 02:07 part avec le pas de 02:10 (après le relevé de 02:05)
    expect(steps[1].refuels).toHaveLength(0);
    expect(steps[2].refuels).toHaveLength(1);
    expect(steps.flatMap((s) => s.telemetry)).toHaveLength(4);
  });

  it('refuse un intervalle inversé', () => {
    expect(() => planSteps(live, instant('10:00'), instant('09:00'))).toThrow();
  });
});
