import { Component, DestroyRef, ElementRef, effect, inject, input, viewChild } from '@angular/core';
import type { FleetOverview } from '@fleet/contracts';
import {
  Chart,
  Filler,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';
import { hourTicks } from '../core/chart-bands';
import { fmtDateTime, fmtTime } from '../core/format';
import { currentLang, t } from '../core/i18n/i18n';
import { STATE_COLORS, readingState, stateLabel } from './fleet-state';

Chart.register(LineController, LineElement, PointElement, LinearScale, Filler, Tooltip);

const STACKED = ['moving', 'idling', 'parked'] as const;
const STEP_MS = 5 * 60_000;

type Point = { x: number; y: number };

/** Stacked areas: number of trucks moving / idling / parked at each 5-min step of the window */
export function activitySeries(overview: FleetOverview): Record<(typeof STACKED)[number], Point[]> {
  const steps = new Map<number, Record<(typeof STACKED)[number], number>>();
  for (const truck of overview.trucks) {
    for (const reading of truck.readings) {
      // readings are on the 5-min grid; rounding protects against an offset of a few seconds
      const step = Math.round(Date.parse(reading.at) / STEP_MS) * STEP_MS;
      let counts = steps.get(step);
      if (!counts) steps.set(step, (counts = { moving: 0, idling: 0, parked: 0 }));
      counts[readingState(reading)]++;
    }
  }
  const ordered = [...steps.entries()].sort(([a], [b]) => a - b);
  return {
    moving: ordered.map(([x, c]) => ({ x, y: c.moving })),
    idling: ordered.map(([x, c]) => ({ x, y: c.idling })),
    parked: ordered.map(([x, c]) => ({ x, y: c.parked })),
  };
}

@Component({
  selector: 'app-fleet-activity-chart',
  template: `
    <div class="chart"><canvas #canvas [attr.aria-label]="t('fleet.activity.title')"></canvas></div>
    <div class="legend">
      @for (s of stacked; track s) {
        <span><i class="sw" [style.background]="colors[s]"></i>{{ stateLabel(s) }}</span>
      }
    </div>
  `,
  styles: `
    .chart {
      position: relative;
      height: 260px;
    }
    .legend {
      display: flex;
      gap: 16px;
      font-size: 13px;
      color: var(--muted);
      margin-top: 6px;
    }
    .sw {
      display: inline-block;
      width: 12px;
      height: 12px;
      border-radius: 3px;
      margin-right: 6px;
      vertical-align: -1px;
    }
  `,
})
export class FleetActivityChart {
  readonly overview = input.required<FleetOverview>();

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private chart: Chart<'line', Point[]> | null = null;

  protected readonly t = t;
  protected readonly stateLabel = stateLabel;
  protected readonly stacked = STACKED;
  protected readonly colors = STATE_COLORS;

  constructor() {
    effect(() => {
      const overview = this.overview();
      currentLang(); // tooltips and dataset labels follow the language
      this.render(overview);
    });
    inject(DestroyRef).onDestroy(() => this.chart?.destroy());
  }

  private render(overview: FleetOverview) {
    const series = activitySeries(overview);
    const min = overview.from ? Date.parse(overview.from) : undefined;
    const max = overview.to ? Date.parse(overview.to) : undefined;

    if (this.chart) {
      STACKED.forEach((state, i) => {
        const dataset = this.chart!.data.datasets[i]!;
        dataset.data = series[state];
        dataset.label = stateLabel(state);
      });
      const x = this.chart.options.scales!['x']!;
      x.min = min;
      x.max = max;
      this.chart.options.scales!['y']!.max = overview.trucks.length;
      this.chart.update('none');
      return;
    }

    this.chart = new Chart(this.canvas().nativeElement, {
      type: 'line',
      data: {
        datasets: STACKED.map((state, i) => ({
          label: stateLabel(state),
          data: series[state],
          borderColor: STATE_COLORS[state],
          backgroundColor: `${STATE_COLORS[state]}55`,
          fill: i === 0 ? 'origin' : '-1',
          borderWidth: 1.5,
          pointRadius: 0,
          stepped: true,
        })),
      },
      options: {
        animation: false,
        maintainAspectRatio: false,
        parsing: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            type: 'linear',
            min,
            max,
            afterBuildTicks: (axis) => {
              axis.ticks = hourTicks(axis.min, axis.max, 8);
            },
            ticks: { callback: (value) => fmtTime(Number(value)), font: { size: 13 } },
            grid: { display: false },
          },
          y: {
            stacked: true,
            min: 0,
            max: overview.trucks.length,
            ticks: { stepSize: 2, precision: 0, font: { size: 13 } },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => fmtDateTime(items[0]?.parsed.x ?? 0),
              label: (item) => `${item.dataset.label}: ${item.parsed.y}`,
            },
          },
        },
      },
    });
  }
}
