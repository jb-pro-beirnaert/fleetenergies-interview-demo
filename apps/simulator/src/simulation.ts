// Simulation pilotée (spec 04, « Machine à états ») : préparation, rejeu cadencé, pause,
// vitesse, arrêt, reset, et reprise après redémarrage à partir du volume du simulateur.

import {
  SIMULATION_COMMANDS,
  type HistoryLoadBatch,
  type SimulationCommand,
  type SimulationSpeed,
  type SimulationStatus,
  type SimulationView,
} from '@fleet/contracts';
import { generate } from './generate.ts';
import { historyBatches } from './load.ts';
import { planSteps, type ReplayStep } from './replay.ts';
import type { SimDataset, SimStore } from './store.ts';
import { STEP_MS, localHHMM, localToUtcMs, todayInParis } from './time.ts';

/** Accès à l'API (remplacé par un faux dans les tests). */
export interface Backend {
  wipe(): Promise<void>;
  loadHistory(batch: HistoryLoadBatch): Promise<void>;
  /** Envoie un pas ; renvoie le nombre d'alertes créées. */
  sendStep(step: ReplayStep): Promise<number>;
  /** Faux si la base est vide (référentiel absent). */
  hasReference(): Promise<boolean>;
  waitUntilReady(log: (line: string) => void): Promise<void>;
}

export interface SimulationOptions {
  backend: Backend;
  store: SimStore;
  seed: number;
  /** Vitesse initiale. */
  speed: SimulationSpeed;
  /** Début et fin du rejeu, en minutes depuis minuit (heure de Paris). */
  fromMin: number;
  toMin: number;
  today?: () => string;
  generateDataset?: (seed: number, today: string) => SimDataset;
  /** Durée réelle d'un pas de 5 min simulées. */
  stepDelayMs?: (speed: SimulationSpeed) => number;
  log?: (line: string) => void;
}

export class CommandRejected extends Error {}

export function datasetOf(seed: number, today: string): SimDataset {
  const { calendar, reference, history, live } = generate(seed, today);
  return { seed, demoDate: calendar.demoDate, reference, history, live };
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class Simulation {
  private status: SimulationStatus = 'idle';
  private speed: SimulationSpeed;
  private demoDate: string | null = null;
  /** Heure simulée du dernier pas envoyé (ms UTC). */
  private clock: number | null = null;
  private alertsCreated = 0;
  private error: string | null = null;
  private loadProgress: { done: number; total: number } | null = null;

  private dataset: SimDataset | null = null;
  private steps: ReplayStep[] | null = null;

  /** Travail de fond en cours (préparation puis rejeu) et moyen de l'interrompre. */
  private task: Promise<void> | null = null;
  private abort = new AbortController();
  /** Réveille l'attente entre deux pas (pause, arrêt, vitesse, reset). */
  private wake: (() => void) | null = null;
  /** File des commandes : une commande attend la fin de la précédente. */
  private queue: Promise<unknown> = Promise.resolve();

  private readonly options: Required<SimulationOptions>;

  constructor(options: SimulationOptions) {
    this.options = {
      today: () => todayInParis(),
      generateDataset: datasetOf,
      stepDelayMs: (speed) => STEP_MS / speed,
      log: (line) => console.log(line),
      ...options,
    };
    this.speed = options.speed;
  }

  view(): SimulationView {
    return {
      status: this.status,
      demoDate: this.demoDate,
      clock: this.clock === null ? null : new Date(this.clock).toISOString(),
      speed: this.speed,
      progress: this.status === 'preparing' ? this.loadProgress : this.stepProgress(),
      alertsCreated: this.alertsCreated,
      error: this.error,
    };
  }

  // --- Commandes (sérialisées) ----------------------------------------------------------------

  command(command: SimulationCommand): Promise<SimulationView> {
    return this.enqueue(async () => {
      if (!SIMULATION_COMMANDS[this.status].includes(command)) {
        throw new CommandRejected(`Commande « ${command} » impossible dans l'état « ${this.status} »`);
      }
      switch (command) {
        case 'start':
          return this.start();
        case 'pause':
          return this.halt('paused');
        case 'resume':
          return this.resume();
        case 'stop':
          return this.halt('finished');
        case 'reset':
          return this.reset();
      }
    });
  }

  setSpeed(speed: SimulationSpeed): Promise<SimulationView> {
    return this.enqueue(async () => {
      this.speed = speed;
      this.wake?.();
      await this.persist();
      this.options.log(`Vitesse ×${speed}`);
    });
  }

  private enqueue(action: () => Promise<void>): Promise<SimulationView> {
    const result = this.queue.then(action).then(() => this.view());
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async start() {
    await this.stopTask();
    this.abort = new AbortController();
    this.status = 'preparing';
    this.error = null;
    this.loadProgress = null;
    this.dataset = null;
    this.steps = null;
    this.demoDate = null;
    this.clock = null;
    this.alertsCreated = 0;
    const signal = this.abort.signal;
    this.background(this.prepare(signal, { fresh: true }).then((ok) => (ok ? this.run(signal) : undefined)));
  }

  private async resume() {
    await this.stopTask();
    this.abort = new AbortController();
    this.status = 'running';
    this.error = null;
    await this.persist();
    this.background(this.run(this.abort.signal));
  }

  /** Pause ou arrêt : la boucle s'arrête après le pas en cours. */
  private async halt(status: 'paused' | 'finished') {
    this.status = status;
    this.wake?.();
    await this.task;
    this.task = null;
    await this.persist();
    this.options.log(status === 'paused' ? 'Simulation en pause' : 'Simulation terminée');
  }

  private async reset() {
    await this.stopTask();
    await this.options.backend.wipe();
    await this.options.store.clear();
    this.status = 'idle';
    this.demoDate = null;
    this.clock = null;
    this.alertsCreated = 0;
    this.error = null;
    this.loadProgress = null;
    this.dataset = null;
    this.steps = null;
    this.options.log('Simulation remise à zéro');
  }

  /** Lance le travail de fond ; une erreur inattendue (écriture sur le volume…) met en pause au lieu de faire planter le service. */
  private background(work: Promise<void>) {
    this.task = work.catch((error: unknown) => {
      this.status = this.steps ? 'paused' : 'idle';
      this.error = `Erreur inattendue : ${errorMessage(error)}`;
      this.options.log(this.error);
    });
  }

  /** Interrompt le travail de fond (préparation ou rejeu) et attend qu'il soit fini. */
  private async stopTask() {
    this.abort.abort();
    this.wake?.();
    await this.task;
    this.task = null;
  }

  // --- Préparation ----------------------------------------------------------------------------

  /**
   * `fresh` : vide la base et génère un nouveau jeu de données (start) ;
   * sinon relit `dataset.json` et relance le chargement (reprise d'un `preparing` interrompu).
   * Renvoie vrai si la préparation est allée au bout.
   */
  private async prepare(signal: AbortSignal, { fresh }: { fresh: boolean }): Promise<boolean> {
    const { backend, store, log } = this.options;
    try {
      if (fresh) {
        await backend.wipe();
        const today = this.options.today();
        log(`Préparation de la journée du ${today} (graine ${this.options.seed})…`);
        this.dataset = this.options.generateDataset(this.options.seed, today);
        await store.writeDataset(this.dataset);
        this.demoDate = this.dataset.demoDate;
        await this.persist();
      }
      const dataset = this.dataset;
      if (!dataset) throw new Error('Jeu de données absent');
      const batches = historyBatches(dataset.reference, dataset.history);
      this.loadProgress = { done: 0, total: batches.length };
      for (const batch of batches) {
        if (signal.aborted) return false;
        await backend.loadHistory(batch);
        this.loadProgress = { done: this.loadProgress.done + 1, total: batches.length };
      }
      if (signal.aborted) return false;
      this.steps = this.planDay(dataset);
      this.status = fresh ? 'running' : 'paused';
      await this.persist();
      log(`Historique chargé (${batches.length} lots) ; ${this.steps.length} pas à rejouer`);
      return fresh;
    } catch (error) {
      if (signal.aborted) return false;
      this.status = 'idle';
      this.error = `Préparation impossible : ${errorMessage(error)}`;
      this.loadProgress = null;
      await this.persist();
      log(this.error);
      return false;
    }
  }

  private planDay(dataset: SimDataset): ReplayStep[] {
    const from = localToUtcMs(dataset.demoDate, this.options.fromMin);
    const to = localToUtcMs(dataset.demoDate, this.options.toMin);
    return planSteps(dataset.live, from, to);
  }

  // --- Rejeu ----------------------------------------------------------------------------------

  /** Envoie les pas restants au rythme de la vitesse courante, tant que l'état est `running`. */
  private async run(signal: AbortSignal) {
    const steps = this.steps!;
    const { backend, log } = this.options;
    for (let index = this.nextStepIndex(); index < steps.length; index++) {
      if (this.status !== 'running' || signal.aborted) return;
      const step = steps[index];
      const startedAt = performance.now();
      let alerts: number;
      try {
        alerts = await backend.sendStep(step);
      } catch (error) {
        if (signal.aborted) return;
        this.status = 'paused';
        this.error = `Envoi du pas de ${localHHMM(step.clock)} impossible : ${errorMessage(error)}`;
        await this.persist();
        log(this.error);
        return;
      }
      if (signal.aborted) return;
      this.clock = step.clock;
      this.alertsCreated += alerts;
      await this.persist();
      log(
        `${localHHMM(step.clock)} │ relevés ${String(step.telemetry.length).padStart(3)} · pleins ${step.refuels.length} · messages ${step.messages.length} │ ` +
          (alerts > 0 ? `alertes +${alerts} (total ${this.alertsCreated}) 🚨` : `alertes ${this.alertsCreated}`),
      );
      if (index < steps.length - 1) await this.waitNextStep(startedAt);
    }
    if (this.status === 'running' && !signal.aborted) {
      this.status = 'finished';
      await this.persist();
      log(`Journée terminée : ${this.alertsCreated} alerte(s) créée(s)`);
    }
  }

  /** Attend la fin du pas ; un changement de vitesse recalcule l'échéance aussitôt. */
  private async waitNextStep(startedAt: number) {
    while (this.status === 'running' && !this.abort.signal.aborted) {
      const remaining = startedAt + this.options.stepDelayMs(this.speed) - performance.now();
      if (remaining <= 0) return;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, remaining);
        this.wake = done;
        function done() {
          clearTimeout(timer);
          resolve();
        }
      });
      this.wake = null;
    }
  }

  private nextStepIndex(): number {
    const clock = this.clock;
    if (clock === null || !this.steps) return 0;
    const index = this.steps.findIndex((step) => step.clock > clock);
    return index === -1 ? this.steps.length : index;
  }

  private stepProgress() {
    if (!this.steps) return null;
    return { done: this.nextStepIndex(), total: this.steps.length };
  }

  // --- Persistance et reprise -----------------------------------------------------------------

  private persist() {
    return this.options.store.writeState({
      status: this.status,
      seed: this.options.seed,
      demoDate: this.demoDate,
      clock: this.clock === null ? null : new Date(this.clock).toISOString(),
      speed: this.speed,
      alertsCreated: this.alertsCreated,
    });
  }

  /** Au démarrage du service : reprend l'état laissé sur le volume (spec 04, « Persistance et reprise »). */
  async recover(): Promise<SimulationView> {
    const { backend, store, log } = this.options;
    await backend.waitUntilReady(log);
    return this.enqueue(async () => {
      const state = await store.readState();
      if (!state) return;
      this.speed = state.speed;
      this.demoDate = state.demoDate;
      this.clock = state.clock === null ? null : Date.parse(state.clock);
      this.alertsCreated = state.alertsCreated;
      if (state.status === 'idle') return;

      const dataset = await store.readDataset();
      const emptied = state.status !== 'preparing' && !(await backend.hasReference());
      if (!dataset || dataset.seed !== state.seed || emptied) {
        log('État de simulation sans données correspondantes : retour à « idle »');
        await store.clear();
        this.status = 'idle';
        this.demoDate = null;
        this.clock = null;
        this.alertsCreated = 0;
        return;
      }
      this.dataset = dataset;
      if (state.status === 'preparing') {
        log('Reprise du chargement de l’historique interrompu');
        this.status = 'preparing';
        this.abort = new AbortController();
        this.background(this.prepare(this.abort.signal, { fresh: false }).then(() => undefined));
        return;
      }
      this.steps = this.planDay(dataset);
      this.status = state.status === 'finished' ? 'finished' : 'paused';
      await this.persist();
      if (this.status === 'paused') {
        log(`Simulation reprise en pause à ${this.clock === null ? 'son début' : localHHMM(this.clock)}`);
      }
    });
  }
}
