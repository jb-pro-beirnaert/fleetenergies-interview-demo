import {
  SIMULATION_COMMANDS,
  SIMULATION_SPEEDS,
  type SimulationCommand,
  type SimulationSpeed,
  type SimulationView,
} from '@fleet/contracts';
import { fmtDayMonth } from './format';
import { t } from './i18n/i18n';

/** Is the command accepted in the current state (otherwise the simulator answers 409)? */
export const canRun = (view: SimulationView | null, command: SimulationCommand) =>
  !!view && SIMULATION_COMMANDS[view.status].includes(command);

/** Neighbouring step, or `null` at either end of the scale. */
export function neighbourSpeed(speed: SimulationSpeed, direction: -1 | 1): SimulationSpeed | null {
  const index = SIMULATION_SPEEDS.indexOf(speed);
  return SIMULATION_SPEEDS[index + direction] ?? null;
}

export function simulationLabel(view: SimulationView): string {
  switch (view.status) {
    case 'idle':
      return t('sim.status.idle');
    case 'preparing':
      return view.progress
        ? t('sim.status.preparingProgress', view.progress)
        : t('sim.status.preparing');
    case 'running':
      return view.demoDate
        ? t('sim.status.runningDay', { day: fmtDayMonth(view.demoDate) })
        : t('sim.status.running');
    case 'paused':
      return t('sim.status.paused');
    case 'finished':
      return t('sim.status.finished');
  }
}
