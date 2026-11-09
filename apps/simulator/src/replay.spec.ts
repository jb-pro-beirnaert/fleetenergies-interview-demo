import { describe, expect, it } from 'vitest';
import type { ActivityData } from './generate.ts';
import type { ApiClient } from './api.ts';
import { planSteps, sendStep } from './replay.ts';
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

  it('splits into 5-min steps, catches up what precedes --from and ignores what follows --to', () => {
    const steps = planSteps(live, instant('02:00'), instant('23:30'));
    expect(steps).toHaveLength(259);
    expect(steps[0].telemetry.map((r) => r.recordedAt)).toEqual([iso('01:55'), iso('02:00')]);
    expect(steps[1].telemetry).toHaveLength(1);
    // A refuel at 02:07 goes with the 02:10 step (after the 02:05 reading)
    expect(steps[1].refuels).toHaveLength(0);
    expect(steps[2].refuels).toHaveLength(1);
    expect(steps.flatMap((s) => s.telemetry)).toHaveLength(4);
  });

  it('rejects an inverted interval', () => {
    expect(() => planSteps(live, instant('10:00'), instant('09:00'))).toThrow();
  });

  it('V2: an invoice goes with the step of its sending instant', () => {
    const steps = planSteps(live, instant('02:00'), instant('23:30'), [
      { file: 'B1-overbilled.pdf', receivedAt: iso('02:37') },
      { file: 'late.pdf', receivedAt: iso('23:50') },
    ]);
    expect(steps.findIndex((s) => s.invoices.length > 0)).toBe(8); // 02:40 step
    expect(steps.flatMap((s) => s.invoices).map((i) => i.file)).toEqual(['B1-overbilled.pdf']);
  });
});

describe('sendStep', () => {
  it('V2: sends each invoice as a multipart PDF, after the readings, refuels and messages', async () => {
    const calls: { path: string; body: unknown }[] = [];
    const api = {
      post: async (path: string, _role: string, body: unknown) => {
        calls.push({ path, body });
        return { alertsCreated: 0, inserted: 1 };
      },
      postForm: async (path: string, _role: string, body: FormData) => {
        calls.push({ path, body });
        return {};
      },
    } as unknown as ApiClient;
    const pdf = new TextEncoder().encode('%PDF-1.4 test');
    await sendStep(
      api,
      { clock: instant('02:40'), telemetry: [reading('02:40')], refuels: [], messages: [], invoices: [{ file: 'B1.pdf', receivedAt: iso('02:37') }] },
      async (file) => (file === 'B1.pdf' ? pdf : null),
    );
    expect(calls.map((c) => c.path)).toEqual(['/api/telemetry', '/api/invoices']);
    const form = calls[1].body as FormData;
    expect(form.get('receivedAt')).toBe(iso('02:37'));
    expect(form.get('source')).toBe('live');
    const file = form.get('file') as File;
    expect(file.name).toBe('B1.pdf');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(pdf);

    // PDF missing from the volume: the step fails (the simulation pauses with the message)
    await expect(
      sendStep(api, { clock: 0, telemetry: [], refuels: [], messages: [], invoices: [{ file: 'gone.pdf', receivedAt: iso('02:37') }] }),
    ).rejects.toThrow(/gone.pdf/);
  });
});
