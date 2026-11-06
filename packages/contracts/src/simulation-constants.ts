import type { SimulationCommand, SimulationStatus } from './simulation.ts';

// Constantes du pilotage de la simulation, sans zod : l'écran les importe sans embarquer les schémas

/** Paliers de vitesse (× temps réel), du plus lent au plus rapide. */
export const SIMULATION_SPEEDS = [30, 60, 120, 300, 600] as const;

/** Commandes acceptées dans chaque état (409 sinon) ; le changement de vitesse est toujours accepté. */
export const SIMULATION_COMMANDS: Record<
  SimulationStatus,
  readonly SimulationCommand[]
> = {
  idle: ['start', 'reset'],
  preparing: ['reset'],
  running: ['pause', 'stop', 'reset'],
  paused: ['resume', 'stop', 'reset'],
  finished: ['start', 'reset'],
};
