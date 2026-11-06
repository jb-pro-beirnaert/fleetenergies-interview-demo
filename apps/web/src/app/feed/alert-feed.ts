import { Component, computed, inject } from '@angular/core';
import { ControlRoomStore, FeedFilter } from '../core/control-room.store';
import { fmtDateTime, fmtLiters, fmtPercent } from '../core/format';
import { type MessageKey, t } from '../core/i18n/i18n';
import { alertTypeLabel, categoryLabel } from '../core/labels';
import { StatusPill } from '../core/status-pill';

@Component({
  selector: 'app-alert-feed',
  imports: [StatusPill],
  template: `
    <header>
      <h2>{{ t('feed.title') }}</h2>
      <div class="filters" role="group" [attr.aria-label]="t('feed.filterLabel')">
        @for (f of filters; track f.value) {
          <button
            type="button"
            [class.active]="store.feedFilter() === f.value"
            [attr.aria-pressed]="store.feedFilter() === f.value"
            (click)="store.feedFilter.set(f.value)"
          >
            {{ t(f.label) }}
            <span class="count">{{ counts()[f.value] }}</span>
          </button>
        }
      </div>
    </header>

    @if (store.alerts() === null) {
      <p class="empty">{{ t('common.loading') }}</p>
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
                <span>{{ alertTypeLabel(alert.type) }}</span>
                <span class="liters">{{ fmtLiters(alert.dropL) }}</span>
              </div>
              @if (alert.category) {
                <div class="verdict" [attr.data-category]="alert.category">
                  {{ categoryLabel(alert.category) }} · {{ fmtPercent(alert.confidence) }}
                </div>
              }
            </button>
          </li>
        } @empty {
          <p class="empty">
            {{ t(store.feedFilter() === 'all' ? 'feed.empty' : 'feed.emptyFilter') }}
          </p>
        }
      </ul>
    }
  `,
  styleUrl: './alert-feed.css',
})
export class AlertFeed {
  protected readonly store = inject(ControlRoomStore);
  protected readonly t = t;
  protected readonly alertTypeLabel = alertTypeLabel;
  protected readonly categoryLabel = categoryLabel;
  protected readonly fmtDateTime = fmtDateTime;
  protected readonly fmtLiters = fmtLiters;
  protected readonly fmtPercent = fmtPercent;

  protected readonly filters: { value: FeedFilter; label: MessageKey }[] = [
    { value: 'all', label: 'feed.filter.all' },
    { value: 'todo', label: 'feed.filter.todo' },
    { value: 'closed', label: 'feed.filter.closed' },
  ];

  protected readonly counts = computed(() => {
    const alerts = this.store.alerts() ?? [];
    return {
      all: alerts.length,
      todo: alerts.filter((a) => a.status === 'escalated').length,
      closed: alerts.filter((a) => ['closed', 'confirmed', 'dismissed'].includes(a.status)).length,
    } satisfies Record<FeedFilter, number>;
  });

  /** Alerts present at first load: only later ones are animated when they arrive */
  private firstIds: ReadonlySet<string> | null = null;
  protected readonly initialIds = computed(() => {
    const alerts = this.store.alerts();
    if (alerts && !this.firstIds) this.firstIds = new Set(alerts.map((a) => a.id));
    return this.firstIds;
  });
}
