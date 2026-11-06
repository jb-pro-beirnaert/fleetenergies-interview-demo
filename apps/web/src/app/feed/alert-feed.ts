import { Component, computed, inject } from '@angular/core';
import { ControlRoomStore, FeedFilter } from '../core/control-room.store';
import { fmtDateTime, fmtLiters, fmtPercent } from '../core/format';
import { ALERT_TYPE_LABELS, CATEGORY_LABELS } from '../core/labels';
import { StatusPill } from '../core/status-pill';

@Component({
  selector: 'app-alert-feed',
  imports: [StatusPill],
  template: `
    <header>
      <h2>Flux d’alertes</h2>
      <div class="filters" role="group" aria-label="Filtrer les alertes">
        @for (f of filters; track f.value) {
          <button
            type="button"
            [class.active]="store.feedFilter() === f.value"
            [attr.aria-pressed]="store.feedFilter() === f.value"
            (click)="store.feedFilter.set(f.value)"
          >
            {{ f.label }}
            <span class="count">{{ counts()[f.value] }}</span>
          </button>
        }
      </div>
    </header>

    @if (store.alerts() === null) {
      <p class="empty">Chargement…</p>
    } @else {
      <ul>
        @for (alert of store.filteredAlerts(); track alert.id) {
          <li>
            <button
              type="button"
              class="item"
              [class.enter]="!initialIds()?.has(alert.id)"
              [class.selected]="alert.id === store.selectedId()"
              (click)="store.select(alert.id)"
            >
              <div class="row">
                <strong class="plate">{{ alert.plate }}</strong>
                <app-status-pill [status]="alert.status" />
              </div>
              <div class="row sub">
                <span>{{ alert.carrier }}</span>
                <span class="time">{{ fmtDateTime(alert.windowStart) }}</span>
              </div>
              <div class="row sub">
                <span>{{ typeLabels[alert.type] }}</span>
                <span class="liters">{{ fmtLiters(alert.dropL) }}</span>
              </div>
              @if (alert.category) {
                <div class="verdict" [attr.data-category]="alert.category">
                  {{ categoryLabels[alert.category] }} · {{ fmtPercent(alert.confidence) }}
                </div>
              }
            </button>
          </li>
        } @empty {
          <p class="empty">
            {{
              store.feedFilter() === 'all'
                ? 'Aucune alerte pour l’instant.'
                : 'Aucune alerte dans ce filtre.'
            }}
          </p>
        }
      </ul>
    }
  `,
  styleUrl: './alert-feed.css',
})
export class AlertFeed {
  protected readonly store = inject(ControlRoomStore);
  protected readonly typeLabels = ALERT_TYPE_LABELS;
  protected readonly categoryLabels = CATEGORY_LABELS;
  protected readonly fmtDateTime = fmtDateTime;
  protected readonly fmtLiters = fmtLiters;
  protected readonly fmtPercent = fmtPercent;

  protected readonly filters: { value: FeedFilter; label: string }[] = [
    { value: 'all', label: 'Toutes' },
    { value: 'todo', label: 'À traiter' },
    { value: 'closed', label: 'Classées' },
  ];

  protected readonly counts = computed(() => {
    const alerts = this.store.alerts() ?? [];
    return {
      all: alerts.length,
      todo: alerts.filter((a) => a.status === 'escalated').length,
      closed: alerts.filter((a) => ['closed', 'confirmed', 'dismissed'].includes(a.status)).length,
    } satisfies Record<FeedFilter, number>;
  });

  /** Alertes présentes au premier chargement : seules les suivantes sont animées à leur arrivée */
  private firstIds: ReadonlySet<string> | null = null;
  protected readonly initialIds = computed(() => {
    const alerts = this.store.alerts();
    if (alerts && !this.firstIds) this.firstIds = new Set(alerts.map((a) => a.id));
    return this.firstIds;
  });
}
