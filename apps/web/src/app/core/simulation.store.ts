import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import type { SimulationCommand, SimulationSpeed, SimulationView } from '@fleet/contracts';
import { type Observable, firstValueFrom } from 'rxjs';
import { poll } from './polling';

/** Pilotage du simulateur (`/simulation*`, proxifié vers le service `simulator`). */
@Injectable({ providedIn: 'root' })
export class SimulationStore {
  private readonly http = inject(HttpClient);

  private readonly lastView = signal<SimulationView | null>(null);
  readonly view = this.lastView.asReadonly();
  /** `undefined` tant qu'aucune réponse n'est arrivée */
  readonly reachable = signal<boolean | undefined>(undefined);
  /** Commande en cours : les boutons sont grisés */
  readonly busy = signal(false);
  readonly commandError = signal<string | null>(null);

  constructor() {
    poll(() => this.http.get<SimulationView>('/simulation')).subscribe((r) => {
      this.reachable.set(r.ok);
      if (r.ok) this.lastView.set(r.value);
    });
  }

  run(command: SimulationCommand) {
    return this.send(this.http.post<SimulationView>(`/simulation/${command}`, null));
  }

  setSpeed(speed: SimulationSpeed) {
    return this.send(this.http.put<SimulationView>('/simulation/speed', { speed }));
  }

  /** La vue renvoyée remplace l'état affiché sans attendre le polling. */
  private async send(request: Observable<SimulationView>) {
    this.busy.set(true);
    this.commandError.set(null);
    try {
      this.lastView.set(await firstValueFrom(request));
    } catch (err) {
      const message = err instanceof HttpErrorResponse ? err.error?.message : null;
      this.commandError.set(message ?? 'Le simulateur n’a pas pu exécuter la commande.');
    } finally {
      this.busy.set(false);
    }
  }
}
