import type { SimulationView } from '@fleet/contracts';
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
  it('n’autorise que les commandes acceptées dans l’état courant', () => {
    expect(canRun(null, 'start')).toBe(false);
    expect(canRun(view({ status: 'idle' }), 'start')).toBe(true);
    expect(canRun(view({ status: 'idle' }), 'pause')).toBe(false);
    expect(canRun(view({ status: 'running' }), 'pause')).toBe(true);
    expect(canRun(view({ status: 'running' }), 'start')).toBe(false);
    expect(canRun(view({ status: 'paused' }), 'resume')).toBe(true);
    expect(canRun(view({ status: 'preparing' }), 'stop')).toBe(false);
    expect(canRun(view({ status: 'preparing' }), 'reset')).toBe(true);
  });

  it('passe au palier de vitesse voisin, sans dépasser les bornes', () => {
    expect(neighbourSpeed(120, 1)).toBe(300);
    expect(neighbourSpeed(120, -1)).toBe(60);
    expect(neighbourSpeed(600, 1)).toBeNull();
    expect(neighbourSpeed(30, -1)).toBeNull();
  });

  it('décrit l’état en français', () => {
    expect(simulationLabel(view({ status: 'preparing', progress: { done: 42, total: 216 } }))).toBe(
      'Préparation… 42 / 216 lots',
    );
    expect(simulationLabel(view({ status: 'running', demoDate: '2026-11-06' }))).toBe(
      'En cours · journée du 06/11',
    );
    expect(simulationLabel(view({ status: 'finished' }))).toBe('Terminée');
  });
});
