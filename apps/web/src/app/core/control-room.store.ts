import { Injectable, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import type { AlertDetail, AlertListItem, ReviewDecision, Stats } from '@fleet/contracts';
import { Subject, filter, firstValueFrom, map, merge, of, switchMap } from 'rxjs';
import { ApiService } from './api.service';
import { poll } from './polling';

export type FeedFilter = 'all' | 'todo' | 'closed';

/** État partagé de la salle de contrôle, alimenté par polling (2 s). */
@Injectable({ providedIn: 'root' })
export class ControlRoomStore {
  private readonly api = inject(ApiService);

  // --- Santé, statistiques, alertes ---------------------------------------------------------

  private readonly healthPoll = toSignal(poll(() => this.api.health()));
  /** `undefined` tant qu'aucune réponse n'est arrivée */
  readonly healthy = computed(() => {
    const result = this.healthPoll();
    return result === undefined ? undefined : result.ok;
  });

  private readonly lastStats = signal<Stats | null>(null);
  private readonly lastAlerts = signal<AlertListItem[] | null>(null);
  readonly stats = this.lastStats.asReadonly();
  /** `null` tant que la première liste n'est pas chargée */
  readonly alerts = this.lastAlerts.asReadonly();

  constructor() {
    // En cas d'erreur, on garde la dernière valeur connue (le point rouge signale l'incident)
    poll(() => this.api.stats()).subscribe((r) => r.ok && this.lastStats.set(r.value));
    poll(() => this.api.alerts()).subscribe((r) => r.ok && this.lastAlerts.set(r.value));
  }

  // --- Filtre du flux -------------------------------------------------------------------------

  readonly feedFilter = signal<FeedFilter>('all');
  readonly filteredAlerts = computed(() => {
    const alerts = this.alerts() ?? [];
    switch (this.feedFilter()) {
      case 'todo':
        return alerts.filter((a) => a.status === 'escalated');
      case 'closed':
        return alerts.filter((a) => ['closed', 'confirmed', 'dismissed'].includes(a.status));
      default:
        return alerts;
    }
  });

  // --- Sélection ------------------------------------------------------------------------------

  /** Choix explicite de l'utilisateur ; tant qu'il est `null`, la sélection est automatique */
  private readonly manualSelection = signal<string | null>(null);
  private readonly autoSelection = signal<string | null>(null);

  /** Par défaut : la dernière alerte en enquête, sinon la sélection automatique précédente, sinon la plus récente. */
  readonly selectedId = computed(() => {
    const manual = this.manualSelection();
    if (manual) return manual;
    const alerts = this.alerts() ?? [];
    const investigating = alerts.find((a) => a.status === 'investigating');
    if (investigating) return investigating.id;
    const previous = this.autoSelection();
    if (previous && alerts.some((a) => a.id === previous)) return previous;
    return alerts[0]?.id ?? null;
  });

  select(id: string) {
    this.manualSelection.set(id);
  }

  // --- Détail de l'alerte sélectionnée -------------------------------------------------------

  private readonly refreshDetail$ = new Subject<string>();

  private readonly detailState = toSignal(
    toObservable(this.selectedId).pipe(
      switchMap((id) => {
        // mémorise la sélection automatique pour qu'elle reste stable une fois l'enquête finie
        if (!this.manualSelection()) this.autoSelection.set(id);
        if (!id) return of(null);
        return merge(
          poll(() => this.api.alert(id)),
          // rafraîchissement immédiat après une revue
          this.refreshDetail$.pipe(
            filter((refreshId) => refreshId === id),
            switchMap(() => this.api.alert(id)),
            map((value) => ({ ok: true as const, value })),
          ),
        ).pipe(
          filter((r) => r.ok),
          map((r) => r.value),
        );
      }),
    ),
    { initialValue: null },
  );

  /** Détail de l'alerte sélectionnée (jamais celui d'une alerte précédemment sélectionnée) */
  readonly detail = computed<AlertDetail | null>(() => {
    const detail = this.detailState();
    return detail && detail.id === this.selectedId() ? detail : null;
  });

  // --- Revue humaine ----------------------------------------------------------------------------

  async review(alertId: string, decision: ReviewDecision, comment: string) {
    const trimmed = comment.trim();
    await firstValueFrom(
      this.api.review(alertId, { decision, ...(trimmed ? { comment: trimmed } : {}) }),
    );
    this.refreshDetail$.next(alertId);
    // le flux et les indicateurs suivront au prochain tick
  }
}
