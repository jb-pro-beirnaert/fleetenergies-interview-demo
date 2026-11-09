import { Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import type { FleetTruck } from '@fleet/contracts';
import { ControlRoomStore } from '../core/control-room.store';
import { fmtLiters, fmtNumber, fmtPercent, fmtTime } from '../core/format';
import { t } from '../core/i18n/i18n';
import { statusLabel } from '../core/labels';
import { STATE_COLORS, stateLabel } from './fleet-state';
import { TruckChart } from './truck-chart';

@Component({
  selector: 'app-truck-card',
  imports: [TruckChart],
  template: `
    <header>
      <div>
        <strong class="plate">{{ truck().plate }}</strong>
        <span class="state" [style.--c]="color()">{{ stateLabel(truck().state) }}</span>
      </div>
      <div class="muted small">
        {{ truck().carrier }} · {{ truck().make }} {{ truck().model }}
        @if (truck().hasReefer) {
          · {{ t('tools.truck.reefer') }}
        }
      </div>
    </header>

    <div class="figures">
      <span class="speed">{{ t('fleet.truck.speed', { n: speed() }) }}</span>
      <div class="gauge" [title]="t('fleet.legend.level')">
        <div class="bar">
          <div
            class="fill"
            [style.width.%]="levelRatio() * 100"
            [class.low]="levelRatio() < 0.2"
          ></div>
        </div>
        <span>{{ fmtLiters(truck().last?.levelL) }} · {{ fmtPercent(levelRatio()) }}</span>
      </div>
    </div>

    <app-truck-chart [truck]="truck()" [from]="from()" [to]="to()" />

    <footer>
      <span class="muted small">{{
        t('fleet.truck.distance', { n: fmtNumber(truck().distanceKm) })
      }}</span>
      @for (r of truck().refuels; track r.at) {
        <span class="chip refuel">⛽ +{{ fmtLiters(r.liters) }} · {{ fmtTime(r.at) }}</span>
      }
      @for (a of truck().alerts; track a.id) {
        <button
          type="button"
          class="chip alert"
          [title]="t('fleet.truck.alertTitle')"
          (click)="openAlert(a.id, $event)"
        >
          ⚠ −{{ fmtLiters(a.dropL) }} · {{ fmtTime(a.windowStart) }} · {{ statusLabel(a.status) }}
        </button>
      }
    </footer>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px 14px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      cursor: pointer;
      transition:
        border-color 0.15s,
        box-shadow 0.15s;
    }
    :host(.selected) {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-soft);
    }
    .plate {
      font-size: 16px;
      margin-right: 8px;
    }
    .state {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 1px 9px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 600;
      color: var(--c);
      background: color-mix(in srgb, var(--c) 12%, transparent);
    }
    .state::before {
      content: '';
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentColor;
    }
    .muted {
      color: var(--muted);
    }
    .small {
      font-size: 13px;
    }
    .figures {
      display: flex;
      align-items: center;
      gap: 14px;
      font-variant-numeric: tabular-nums;
    }
    .speed {
      font-weight: 700;
      min-width: 72px;
    }
    .gauge {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      white-space: nowrap;
    }
    .bar {
      flex: 1;
      height: 8px;
      border-radius: 4px;
      background: var(--surface-2);
      overflow: hidden;
    }
    .fill {
      height: 100%;
      background: var(--accent);
    }
    .fill.low {
      background: var(--orange);
    }
    footer {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }
    footer > .muted {
      margin-right: auto;
    }
    .chip {
      font-size: 12px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 999px;
      border: 0;
      white-space: nowrap;
    }
    .chip.refuel {
      color: var(--green);
      background: color-mix(in srgb, var(--green) 12%, transparent);
    }
    .chip.alert {
      color: var(--red);
      background: color-mix(in srgb, var(--red) 12%, transparent);
    }
    .chip.alert:hover {
      background: color-mix(in srgb, var(--red) 22%, transparent);
    }
  `,
})
export class TruckCard {
  private readonly store = inject(ControlRoomStore);
  private readonly router = inject(Router);

  readonly truck = input.required<FleetTruck>();
  readonly from = input.required<number>();
  readonly to = input.required<number>();

  protected readonly color = computed(() => STATE_COLORS[this.truck().state]);
  protected readonly speed = computed(() => Math.round(this.truck().last?.speedKmh ?? 0));
  protected readonly levelRatio = computed(() => {
    const truck = this.truck();
    return truck.last ? Math.min(1, truck.last.levelL / truck.tankCapacityL) : 0;
  });

  protected readonly t = t;
  protected readonly stateLabel = stateLabel;
  protected readonly statusLabel = statusLabel;
  protected readonly fmtLiters = fmtLiters;
  protected readonly fmtNumber = fmtNumber;
  protected readonly fmtPercent = fmtPercent;
  protected readonly fmtTime = fmtTime;

  /** Selects the alert in the control room and opens the Alerts tab */
  protected openAlert(alertId: string, event: Event) {
    event.stopPropagation();
    this.store.select(alertId);
    void this.router.navigate(['/']);
  }
}
