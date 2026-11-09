import { z } from 'zod';
import { SIMULATION_SPEEDS } from './simulation-constants.ts';

// Simulator control API (spec 04), called by the control room (spec 07)

export const SimulationStatus = z.enum([
  'idle',
  'preparing',
  'running',
  'paused',
  'finished',
]);
export type SimulationStatus = z.infer<typeof SimulationStatus>;

export const SimulationSpeed = z.literal(SIMULATION_SPEEDS);
export type SimulationSpeed = z.infer<typeof SimulationSpeed>;

export const SimulationCommand = z.enum([
  'start',
  'pause',
  'resume',
  'stop',
  'reset',
]);
export type SimulationCommand = z.infer<typeof SimulationCommand>;

export const SimulationView = z
  .object({
    status: SimulationStatus,
    /** Date of the simulation start (D, Paris date): first day of the demo week */
    demoDate: z.iso.date().nullable(),
    /** Simulated time of the last step sent */
    clock: z.iso.datetime({ offset: true }).nullable(),
    speed: SimulationSpeed,
    /** History batches during `preparing`, steps of the week afterwards */
    progress: z.object({ done: z.int().min(0), total: z.int().min(0) }).nullable(),
    alertsCreated: z.int().min(0),
    error: z.string().nullable(),
  })
  .meta({ id: 'SimulationView' });
export type SimulationView = z.infer<typeof SimulationView>;

export const SimulationSpeedRequest = z
  .object({ speed: SimulationSpeed })
  .meta({ id: 'SimulationSpeedRequest' });
export type SimulationSpeedRequest = z.infer<typeof SimulationSpeedRequest>;
