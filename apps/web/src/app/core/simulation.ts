import {
  SIMULATION_COMMANDS,
  SIMULATION_SPEEDS,
  type SimulationCommand,
  type SimulationSpeed,
  type SimulationView,
} from '@fleet/contracts';

const dayFmt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });

/** La commande est-elle acceptée dans l'état courant (sinon le simulateur répond 409) ? */
export const canRun = (view: SimulationView | null, command: SimulationCommand) =>
  !!view && SIMULATION_COMMANDS[view.status].includes(command);

/** Palier voisin, ou `null` en bout d'échelle. */
export function neighbourSpeed(speed: SimulationSpeed, direction: -1 | 1): SimulationSpeed | null {
  const index = SIMULATION_SPEEDS.indexOf(speed);
  return SIMULATION_SPEEDS[index + direction] ?? null;
}

export function simulationLabel(view: SimulationView): string {
  switch (view.status) {
    case 'idle':
      return 'Prête à démarrer';
    case 'preparing':
      return view.progress
        ? `Préparation… ${view.progress.done} / ${view.progress.total} lots`
        : 'Préparation…';
    case 'running':
      return view.demoDate
        ? `En cours · journée du ${dayFmt.format(new Date(`${view.demoDate}T00:00:00Z`))}`
        : 'En cours';
    case 'paused':
      return 'En pause';
    case 'finished':
      return 'Terminée';
  }
}
