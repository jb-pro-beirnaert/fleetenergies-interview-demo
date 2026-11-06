import { Injectable, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import type { AlertDetail, AlertListItem, ReviewDecision, Stats } from '@fleet/contracts';
import { Subject, filter, firstValueFrom, map, merge, of, switchMap } from 'rxjs';
import { ApiService } from './api.service';
import { poll } from './polling';

export type FeedFilter = 'all' | 'todo' | 'closed';

/** Shared state of the control room, fed by polling (2 s). */
@Injectable({ providedIn: 'root' })
export class ControlRoomStore {
  private readonly api = inject(ApiService);

  // --- Health, statistics, alerts ---------------------------------------------------------

  private readonly healthPoll = toSignal(poll(() => this.api.health()));
  /** `undefined` until a first response has arrived */
  readonly healthy = computed(() => {
    const result = this.healthPoll();
    return result === undefined ? undefined : result.ok;
  });

  private readonly lastStats = signal<Stats | null>(null);
  private readonly lastAlerts = signal<AlertListItem[] | null>(null);
  readonly stats = this.lastStats.asReadonly();
  /** `null` until the first list is loaded */
  readonly alerts = this.lastAlerts.asReadonly();

  constructor() {
    // On error, keep the last known value (the red dot signals the incident)
    poll(() => this.api.stats()).subscribe((r) => r.ok && this.lastStats.set(r.value));
    poll(() => this.api.alerts()).subscribe((r) => r.ok && this.lastAlerts.set(r.value));
  }

  // --- Feed filter ---------------------------------------------------------------------------

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

  // --- Selection ------------------------------------------------------------------------------

  /** Explicit user choice; while it is `null`, the selection is automatic */
  private readonly manualSelection = signal<string | null>(null);
  private readonly autoSelection = signal<string | null>(null);

  /** By default: the latest alert under investigation, else the previous automatic selection, else the most recent. */
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

  // --- Selected alert detail -----------------------------------------------------------------

  private readonly refreshDetail$ = new Subject<string>();

  private readonly detailState = toSignal(
    toObservable(this.selectedId).pipe(
      switchMap((id) => {
        // remember the automatic selection so it stays stable once the investigation is over
        if (!this.manualSelection()) this.autoSelection.set(id);
        if (!id) return of(null);
        return merge(
          poll(() => this.api.alert(id)),
          // immediate refresh after a review
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

  /** Detail of the selected alert (never that of a previously selected alert) */
  readonly detail = computed<AlertDetail | null>(() => {
    const detail = this.detailState();
    return detail && detail.id === this.selectedId() ? detail : null;
  });

  // --- Human review ------------------------------------------------------------------------------

  async review(alertId: string, decision: ReviewDecision, comment: string) {
    const trimmed = comment.trim();
    await firstValueFrom(
      this.api.review(alertId, { decision, ...(trimmed ? { comment: trimmed } : {}) }),
    );
    this.refreshDetail$.next(alertId);
    // the feed and the indicators will follow on the next tick
  }
}
