import type { SimulationView } from '@fleet/contracts';
import { setLang } from './i18n/i18n';
import { canRun, neighbourSpeed, simulationLabel } from './simulation';

const view = (partial: Partial<SimulationView>): SimulationView => ({
  status: 'idle',
  demoDate: null,
  clock: null,
  speed: 120,
  progress: null,
  alertsCreated: 0,
  error: null,
  ...partial,
});

describe('simulation', () => {
  afterEach(() => setLang('en'));

  it('only allows the commands accepted in the current state', () => {
    expect(canRun(null, 'start')).toBe(false);
    expect(canRun(view({ status: 'idle' }), 'start')).toBe(true);
    expect(canRun(view({ status: 'idle' }), 'pause')).toBe(false);
    expect(canRun(view({ status: 'running' }), 'pause')).toBe(true);
    expect(canRun(view({ status: 'running' }), 'start')).toBe(false);
    expect(canRun(view({ status: 'paused' }), 'resume')).toBe(true);
    expect(canRun(view({ status: 'preparing' }), 'stop')).toBe(false);
    expect(canRun(view({ status: 'preparing' }), 'reset')).toBe(true);
  });

  it('moves to the neighbouring speed step, without going past the bounds', () => {
    expect(neighbourSpeed(1000, 1)).toBe(2000);
    expect(neighbourSpeed(1000, -1)).toBe(600);
    expect(neighbourSpeed(4000, 1)).toBeNull();
    expect(neighbourSpeed(60, -1)).toBeNull();
  });

  it('describes the state in English by default', () => {
    expect(simulationLabel(view({ status: 'preparing', progress: { done: 42, total: 216 } }))).toBe(
      'Preparing… 42 / 216 batches',
    );
    expect(simulationLabel(view({ status: 'running', demoDate: '2026-11-06' }))).toBe(
      'Running · week from 06/11',
    );
    expect(simulationLabel(view({ status: 'finished' }))).toBe('Finished');
  });

  it('describes the state in French', () => {
    setLang('fr');
    expect(simulationLabel(view({ status: 'preparing', progress: { done: 42, total: 216 } }))).toBe(
      'Préparation… 42 / 216 lots',
    );
    expect(simulationLabel(view({ status: 'running', demoDate: '2026-11-06' }))).toBe(
      'En cours · semaine du 06/11',
    );
    expect(simulationLabel(view({ status: 'finished' }))).toBe('Terminée');
  });
});
