import type { SimulationCommand, SimulationStatus } from './simulation.ts';

// Simulation control constants, without zod: the screen imports them without bundling the schemas

/**
 * Speed steps (× real time), from slowest to fastest.
 * The demo week (2016 steps of 5 simulated minutes) lasts ≈ 5 min at ×2000.
 */
export const SIMULATION_SPEEDS = [60, 120, 300, 600, 1000, 2000, 4000] as const;

/** Commands accepted in each state (409 otherwise); a speed change is always accepted. */
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
