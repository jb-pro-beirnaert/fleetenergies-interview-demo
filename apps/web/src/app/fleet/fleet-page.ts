import { DOCUMENT } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import type { FleetOverview } from '@fleet/contracts';
import { switchMap } from 'rxjs';
import { ApiService } from '../core/api.service';
import { fmtDateTime, fmtLiters, fmtMinutes, fmtNumber, fmtPercent } from '../core/format';
import { t } from '../core/i18n/i18n';
import { POLL_INTERVAL_MS, poll } from '../core/polling';
import { FleetActivityChart } from './fleet-activity-chart';
import { FleetMap } from './fleet-map';
import { STATE_COLORS, TRUCK_STATES, stateLabel } from './fleet-state';
import { TruckCard } from './truck-card';

const WINDOWS = [6, 12, 24] as const;

/** "Fleet" tab: received telemetry of the whole fleet, live (2 s polling), over a sliding window */
@Component({
  selector: 'app-fleet-page',
  imports: [FleetMap, FleetActivityChart, TruckCard],
  template: `
    <div class="toolbar">
      <h2>{{ t('fleet.title') }}</h2>
      @if (range(); as r) {
        <span class="muted">{{ t('fleet.windowRange', r) }}</span>
      }
      <div class="windows" role="group" [attr.aria-label]="t('fleet.windowLabel')">
        @for (h of windows; track h) {
          <button
            type="button"
            [class.active]="hours() === h"
            [attr.aria-pressed]="hours() === h"
            (click)="hours.set(h)"
          >
            {{ t('fleet.windowHours', { n: h }) }}
          </button>
        }
      </div>
      @if (failed()) {
        <span class="error">{{ t('fleet.unreachable') }}</span>
      }
    </div>

    @if (overview(); as o) {
      @if (o.to && o.from) {
        <div class="kpis">
          <section class="kpi states">
            <span class="label">{{ t('fleet.kpi.now') }}</span>
            <div class="state-counts">
              @for (s of states; track s) {
                <div [style.--c]="colors[s]">
                  <span class="hero">{{ kpis().byState[s] }}</span>
                  <span class="state">{{ stateLabel(s) }}</span>
                </div>
              }
            </div>
          </section>
          <section class="kpi">
            <span class="label">{{ t('fleet.kpi.distance') }}</span>
            <span class="hero">{{ fmtNumber(kpis().distanceKm) }} km</span>
            <span class="muted"
              >{{ t('fleet.kpi.driving') }} {{ fmtMinutes(kpis().movingMinutes) }}</span
            >
          </section>
          <section class="kpi">
            <span class="label">{{ t('fleet.kpi.fuelOnBoard') }}</span>
            <span class="hero">{{ fmtLiters(kpis().fuelL) }}</span>
            <span class="muted">{{
              t('fleet.kpi.fuelOfCapacity', { pct: fmtPercent(kpis().fuelRatio) })
            }}</span>
          </section>
          <section class="kpi">
            <span class="label">{{ t('fleet.kpi.refuels') }}</span>
            <span class="hero green">+{{ fmtLiters(kpis().refueledL) }}</span>
            <span class="muted">{{ t('fleet.kpi.refuelsDetail', { n: kpis().refuels }) }}</span>
          </section>
          <section class="kpi">
            <span class="label">{{ t('fleet.kpi.alerts') }}</span>
            <span class="hero" [class.red]="kpis().alerts > 0">{{ kpis().alerts }}</span>
          </section>
          <section class="kpi">
            <span class="label">{{ t('fleet.kpi.readings') }}</span>
            <span class="hero">{{ fmtNumber(kpis().readings) }}</span>
            <span class="muted">{{ t('fleet.kpi.readingsDetail') }}</span>
          </section>
        </div>

        <div class="row">
          <section class="card">
            <h3>
              {{ t('fleet.map.title') }} <span class="muted">· {{ t('fleet.map.hint') }}</span>
            </h3>
            <app-fleet-map
              [trucks]="o.trucks"
              [selectedId]="selectedId()"
              (select)="toggle($event)"
            />
          </section>
          <section class="card">
            <h3>
              {{ t('fleet.activity.title') }}
              <span class="muted">· {{ t('fleet.activity.hint') }}</span>
            </h3>
            <app-fleet-activity-chart [overview]="o" />
          </section>
        </div>

        <div class="trucks-head">
          <h3>{{ t('fleet.trucks.title') }}</h3>
          <div class="legend">
            <span><i class="sw level"></i>{{ t('fleet.legend.level') }}</span>
            <span><i class="sw speed"></i>{{ t('fleet.legend.speed') }}</span>
            <span><i class="sw alert"></i>{{ t('fleet.legend.alert') }}</span>
            <span><i class="sw off"></i>{{ t('fleet.legend.off') }}</span>
            <span><i class="sw refuel"></i>{{ t('fleet.legend.refuel') }}</span>
          </div>
        </div>
        <div class="grid">
          @for (truck of o.trucks; track truck.id) {
            <app-truck-card
              [truck]="truck"
              [from]="fromMs()"
              [to]="toMs()"
              [class.selected]="truck.id === selectedId()"
              (click)="toggle(truck.id)"
            />
          }
        </div>
      } @else {
        <p class="empty">{{ t('fleet.waiting') }}</p>
      }
    } @else if (!failed()) {
      <p class="empty">{{ t('common.loading') }}</p>
    }
  `,
  styles: `
    :host {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 16px 20px 32px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    h2,
    h3 {
      margin: 0;
    }
    h3 {
      font-size: 15px;
      margin-bottom: 10px;
    }
    .muted {
      color: var(--muted);
      font-weight: 400;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }
    .windows {
      display: flex;
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
    }
    .windows button {
      padding: 4px 12px;
      border: 0;
      background: var(--surface);
      color: var(--muted);
      font-weight: 700;
    }
    .windows button.active {
      background: var(--accent);
      color: white;
    }
    .error {
      color: var(--red);
      font-weight: 600;
    }
    .empty {
      color: var(--muted);
      text-align: center;
      margin-top: 48px;
    }
    .kpis {
      display: grid;
      grid-template-columns: minmax(300px, 2fr) repeat(5, minmax(0, 1fr));
      gap: 12px;
    }
    .kpi,
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px 14px;
    }
    .kpi {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .label {
      font-size: 13px;
      font-weight: 600;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .hero {
      font-size: 28px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      line-height: 1.15;
    }
    .hero.green {
      color: var(--green);
    }
    .hero.red {
      color: var(--red);
    }
    .state-counts {
      display: flex;
      gap: 18px;
    }
    .state-counts > div {
      display: flex;
      flex-direction: column;
      color: var(--c);
    }
    .state {
      font-size: 13px;
      font-weight: 600;
    }
    .row {
      display: grid;
      grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
      gap: 12px;
    }
    .trucks-head {
      display: flex;
      align-items: baseline;
      gap: 20px;
      flex-wrap: wrap;
    }
    .legend {
      display: flex;
      gap: 14px;
      font-size: 13px;
      color: var(--muted);
      flex-wrap: wrap;
    }
    .sw {
      display: inline-block;
      width: 12px;
      height: 12px;
      border-radius: 3px;
      margin-right: 6px;
      vertical-align: -1px;
    }
    .sw.level {
      background: var(--accent);
    }
    .sw.speed {
      height: 2px;
      vertical-align: 3px;
      background: var(--muted);
    }
    .sw.alert {
      background: var(--alert-band);
    }
    .sw.off {
      background: var(--off-band);
    }
    .sw.refuel {
      border-radius: 50%;
      background: var(--green);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
      gap: 12px;
    }
    @media (max-width: 1400px) {
      .kpis {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .kpi.states {
        grid-column: span 3;
      }
    }
    @media (max-width: 1000px) {
      .row {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `,
})
export class FleetPage {
  private readonly api = inject(ApiService);
  private readonly document = inject(DOCUMENT);

  protected readonly windows = WINDOWS;
  protected readonly states = TRUCK_STATES;
  protected readonly colors = STATE_COLORS;
  protected readonly hours = signal<number>(24);
  protected readonly selectedId = signal<string | null>(null);

  /** Last overview received (kept on error: the error message signals the incident) */
  protected readonly overview = signal<FleetOverview | null>(null);
  protected readonly failed = signal(false);

  constructor() {
    toObservable(this.hours)
      .pipe(
        // created inside switchMap, outside the injection context: the document is passed in
        switchMap((hours) => poll(() => this.api.fleet(hours), POLL_INTERVAL_MS, this.document)),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        this.failed.set(!result.ok);
        if (result.ok) this.overview.set(result.value);
      });
  }

  protected readonly fromMs = computed(() => Date.parse(this.overview()?.from ?? '') || 0);
  protected readonly toMs = computed(() => Date.parse(this.overview()?.to ?? '') || 0);

  protected readonly range = computed(() => {
    const o = this.overview();
    return o?.from && o.to ? { from: fmtDateTime(o.from), to: fmtDateTime(o.to) } : null;
  });

  protected readonly kpis = computed(() => {
    const trucks = this.overview()?.trucks ?? [];
    const byState = Object.fromEntries(TRUCK_STATES.map((s) => [s, 0])) as Record<
      (typeof TRUCK_STATES)[number],
      number
    >;
    let distanceKm = 0;
    let movingMinutes = 0;
    let fuelL = 0;
    let capacityL = 0;
    let refuels = 0;
    let refueledL = 0;
    let alerts = 0;
    let readings = 0;
    for (const truck of trucks) {
      byState[truck.state]++;
      distanceKm += truck.distanceKm;
      movingMinutes += truck.movingMinutes;
      fuelL += truck.last?.levelL ?? 0;
      capacityL += truck.tankCapacityL;
      refuels += truck.refuels.length;
      refueledL += truck.refuels.reduce((sum, r) => sum + r.liters, 0);
      alerts += truck.alerts.length;
      readings += truck.readings.length;
    }
    return {
      byState,
      distanceKm,
      movingMinutes,
      fuelL,
      fuelRatio: capacityL ? fuelL / capacityL : null,
      refuels,
      refueledL,
      alerts,
      readings,
    };
  });

  protected toggle(truckId: string) {
    this.selectedId.update((current) => (current === truckId ? null : truckId));
  }

  protected readonly t = t;
  protected readonly stateLabel = stateLabel;
  protected readonly fmtNumber = fmtNumber;
  protected readonly fmtLiters = fmtLiters;
  protected readonly fmtMinutes = fmtMinutes;
  protected readonly fmtPercent = fmtPercent;
}
