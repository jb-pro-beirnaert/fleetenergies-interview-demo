import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import type { SimulationCommand, SimulationSpeed, SimulationView } from '@fleet/contracts';
import { type Observable, firstValueFrom } from 'rxjs';
import { poll } from './polling';

/** Simulator control (`/simulation*`, proxied to the `simulator` service). */
@Injectable({ providedIn: 'root' })
export class SimulationStore {
  private readonly http = inject(HttpClient);

  private readonly lastView = signal<SimulationView | null>(null);
  readonly view = this.lastView.asReadonly();
  /** `undefined` until a first response has arrived */
  readonly reachable = signal<boolean | undefined>(undefined);
  /** Command in flight: the buttons are disabled */
  readonly busy = signal(false);
  /** Last command failure; `message` is the simulator's own message, if it sent one */
  readonly commandError = signal<{ message: string | null } | null>(null);

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

  /** The returned view replaces the displayed state without waiting for polling. */
  private async send(request: Observable<SimulationView>) {
    this.busy.set(true);
    this.commandError.set(null);
    try {
      this.lastView.set(await firstValueFrom(request));
    } catch (err) {
      const message = err instanceof HttpErrorResponse ? err.error?.message : null;
      this.commandError.set({ message: typeof message === 'string' ? message : null });
    } finally {
      this.busy.set(false);
    }
  }
}
