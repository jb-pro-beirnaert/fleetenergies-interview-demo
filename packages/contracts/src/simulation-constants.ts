import type { SimulationCommand, SimulationStatus } from './simulation.ts';

// Simulation control constants, without zod: the screen imports them without bundling the schemas

/** Speed steps (× real time), from slowest to fastest. */
export const SIMULATION_SPEEDS = [30, 60, 120, 300, 600] as const;

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
