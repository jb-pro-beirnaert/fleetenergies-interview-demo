import { z } from 'zod';
import { SIMULATION_SPEEDS } from './simulation-constants.ts';

// API de contrôle du simulateur (spec 04), appelée par la salle de contrôle (spec 07)

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
    /** Journée de démo (J, date de Paris) */
    demoDate: z.iso.date().nullable(),
    /** Heure simulée du dernier pas envoyé */
    clock: z.iso.datetime({ offset: true }).nullable(),
    speed: SimulationSpeed,
    /** Lots d'historique pendant `preparing`, pas de la journée ensuite */
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
