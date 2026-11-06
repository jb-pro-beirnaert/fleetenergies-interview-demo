import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HistoryLoadBatch, SimulationSpeed, SimulationStatus } from '@fleet/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ReplayStep } from './replay.ts';
import { CommandRejected, Simulation, type Backend, type SimulationOptions } from './simulation.ts';
import { fileStore, type SimDataset, type SimStore } from './store.ts';
import { localToUtcMs, parseHHMM } from './time.ts';

const DEMO_DAY = '2026-11-06';
const TRUCK = '00000000-0000-4000-8000-000000000001';
const iso = (hhmm: string) => new Date(localToUtcMs(DEMO_DAY, parseHHMM(hhmm))).toISOString();
const reading = (recordedAt: string) => ({
  truckId: TRUCK, recordedAt, lat: 44, lon: 4.8, speedKmh: 0, ignition: false, fuelLevelL: 300, odometerKm: 1000,
});

/** Minimal dataset: day replayed from 02:00 to 02:45 (10 steps), one alert at the 02:20 step. */
const tinyDataset = (seed: number, today: string): SimDataset => ({
  seed,
  demoDate: today,
  reference: { carriers: [], places: [], trucks: [], drivers: [], assignments: [] },
  history: {
    telemetry: Array.from({ length: 1_200 }, (_, i) => reading(new Date(Date.UTC(2026, 9, 10) + i * 300_000).toISOString())),
    refuels: [],
    messages: [],
  },
  live: {
    telemetry: ['01:55', '02:00', '02:05', '02:20', '02:45'].map((t) => reading(iso(t))),
    refuels: [],
    messages: [],
  },
});

/** Fake backend: records the calls; `gate` makes it possible to suspend a send. */
class FakeBackend implements Backend {
  calls: string[] = [];
  sentClocks: number[] = [];
  loaded: HistoryLoadBatch[] = [];
  empty = false;
  failNextStep = false;
  loadGate: Promise<void> | null = null;

  async wipe() {
    this.calls.push('wipe');
    this.loaded = [];
    this.sentClocks = [];
  }
  async loadHistory(batch: HistoryLoadBatch) {
    if (this.loadGate) await this.loadGate;
    this.calls.push('load');
    this.loaded.push(batch);
  }
  async sendStep(step: ReplayStep) {
    if (this.failNextStep) {
      this.failNextStep = false;
      throw new Error('API injoignable');
    }
    this.sentClocks.push(step.clock);
    return step.telemetry.some((r) => r.recordedAt === iso('02:20')) ? 1 : 0;
  }
  async hasReference() {
    return !this.empty;
  }
  async waitUntilReady() {}
}

const until = async (predicate: () => boolean, timeoutMs = 3_000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
};

describe('Simulation', () => {
  let dir: string;
  let store: SimStore;
  let backend: FakeBackend;
  const delays: Record<number, number> = { 30: 10_000, 60: 20, 120: 0, 300: 0, 600: 0 };

  const create = (overrides: Partial<SimulationOptions> = {}) =>
    new Simulation({
      backend,
      store,
      seed: 42,
      speed: 60,
      fromMin: parseHHMM('02:00'),
      toMin: parseHHMM('02:45'),
      today: () => DEMO_DAY,
      generateDataset: tinyDataset,
      stepDelayMs: (speed: SimulationSpeed) => delays[speed],
      log: () => {},
      ...overrides,
    });
  const statusOf = (simulation: Simulation): SimulationStatus => simulation.view().status;

  // One folder per test, deleted at the end: a simulation may still be finishing writing its state
  let root: string;
  let count = 0;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'simulator-'));
  });
  afterAll(() => rm(root, { recursive: true, force: true }));
  beforeEach(() => {
    dir = join(root, String(++count));
    store = fileStore(dir);
    backend = new FakeBackend();
  });

  it('start: wipes the database, loads the history, replays the whole day then finishes', async () => {
    const simulation = create({ speed: 120 });
    const view = await simulation.command('start');
    expect(view.status).toBe('preparing');
    await until(() => statusOf(simulation) === 'finished');

    expect(backend.calls[0]).toBe('wipe');
    expect(backend.loaded).toHaveLength(4); // reference data + 3 reading batches
    expect(backend.sentClocks).toHaveLength(10);
    expect(backend.sentClocks).toEqual([...backend.sentClocks].sort((a, b) => a - b));
    const final = simulation.view();
    expect(final).toMatchObject({ demoDate: DEMO_DAY, alertsCreated: 1, clock: iso('02:45'), progress: { done: 10, total: 10 } });
    expect(await store.readState()).toMatchObject({ status: 'finished', alertsCreated: 1, clock: iso('02:45') });
  });

  it('rejects (409) commands outside the accepted states', async () => {
    const simulation = create();
    await expect(simulation.command('pause')).rejects.toBeInstanceOf(CommandRejected);
    await expect(simulation.command('resume')).rejects.toBeInstanceOf(CommandRejected);
    await simulation.command('start');
    await until(() => statusOf(simulation) === 'running');
    await expect(simulation.command('start')).rejects.toBeInstanceOf(CommandRejected);
    await simulation.command('reset');
  });

  it('pause then resume: no step lost or sent twice', async () => {
    const simulation = create();
    await simulation.command('start');
    await until(() => backend.sentClocks.length >= 3);
    const paused = await simulation.command('pause');
    expect(paused.status).toBe('paused');
    const sentAtPause = backend.sentClocks.length;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(backend.sentClocks).toHaveLength(sentAtPause);

    await simulation.command('resume');
    await until(() => statusOf(simulation) === 'finished');
    expect(new Set(backend.sentClocks).size).toBe(10);
    expect(backend.sentClocks).toHaveLength(10);
  });

  it('stop: finishes without sending the rest; reset: wipes the database and goes back to idle', async () => {
    const simulation = create();
    await simulation.command('start');
    await until(() => backend.sentClocks.length >= 2);
    expect((await simulation.command('stop')).status).toBe('finished');
    const sent = backend.sentClocks.length;
    expect(sent).toBeLessThan(10);

    const view = await simulation.command('reset');
    expect(view).toMatchObject({ status: 'idle', demoDate: null, clock: null, alertsCreated: 0, progress: null });
    expect(backend.calls.filter((c) => c === 'wipe')).toHaveLength(2);
    expect(await store.readState()).toBeNull();
    expect(await store.readDataset()).toBeNull();
  });

  it('a reset during the preparation cancels the loading', async () => {
    let release!: () => void;
    backend.loadGate = new Promise((resolve) => (release = resolve));
    const simulation = create();
    await simulation.command('start');
    const reset = simulation.command('reset');
    release();
    expect((await reset).status).toBe('idle');
    expect(backend.loaded.length).toBeLessThanOrEqual(1);
    expect(backend.sentClocks).toHaveLength(0);
  });

  it('a speed change applies without waiting for the end of the step', async () => {
    const simulation = create({ speed: 30 }); // 10 s per step
    await simulation.command('start');
    await until(() => backend.sentClocks.length === 1);
    await simulation.setSpeed(600);
    await until(() => statusOf(simulation) === 'finished', 1_000);
    expect(simulation.view().speed).toBe(600);
  });

  it('a send error pauses with the message; resume restarts at the same step', async () => {
    const simulation = create();
    await simulation.command('start');
    await until(() => backend.sentClocks.length >= 2);
    backend.failNextStep = true;
    await until(() => statusOf(simulation) === 'paused');
    expect(simulation.view().error).toMatch(/API injoignable/);

    await simulation.command('resume');
    expect(simulation.view().error).toBeNull();
    await until(() => statusOf(simulation) === 'finished');
    expect(new Set(backend.sentClocks).size).toBe(10);
  });

  it('resume after a restart: paused at the same time, then end of day without duplicates', async () => {
    const first = create();
    await first.command('start');
    await until(() => backend.sentClocks.length >= 4);
    await first.command('pause'); // the state is on the volume, as after a container stop
    const clock = first.view().clock;
    const sent = [...backend.sentClocks];

    const second = create({ speed: 120 });
    const view = await second.recover();
    expect(view).toMatchObject({ status: 'paused', clock, speed: 60, demoDate: DEMO_DAY, progress: { done: sent.length, total: 10 } });

    await second.command('resume');
    await until(() => statusOf(second) === 'finished');
    expect(backend.sentClocks).toHaveLength(10);
    expect(new Set(backend.sentClocks).size).toBe(10);
    expect(second.view().alertsCreated).toBe(1);
  });

  it('resume of an interrupted loading: reloads the history then pauses at the start', async () => {
    // state left on the volume by a process stopped in the middle of loading
    await store.writeDataset(tinyDataset(42, DEMO_DAY));
    await store.writeState({ status: 'preparing', seed: 42, demoDate: DEMO_DAY, clock: null, speed: 60, alertsCreated: 0 });

    const simulation = create();
    expect((await simulation.recover()).status).toBe('preparing');
    await until(() => statusOf(simulation) === 'paused');
    expect(backend.calls).not.toContain('wipe');
    expect(backend.loaded).toHaveLength(4);
    expect(simulation.view()).toMatchObject({ clock: null, progress: { done: 0, total: 10 } });
  });

  it('safeguard: database wiped in the meantime → back to idle and files deleted', async () => {
    const first = create();
    await first.command('start');
    await until(() => backend.sentClocks.length >= 2);
    await first.command('pause');

    backend.empty = true;
    const view = await create().recover();
    expect(view).toMatchObject({ status: 'idle', clock: null, demoDate: null });
    expect(await store.readState()).toBeNull();
  });
});
