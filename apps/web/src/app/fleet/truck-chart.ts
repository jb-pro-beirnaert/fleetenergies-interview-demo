import { Component, DestroyRef, ElementRef, effect, inject, input, viewChild } from '@angular/core';
import type { FleetTruck } from '@fleet/contracts';
import {
  Chart,
  Filler,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type Plugin,
} from 'chart.js';
import { type Band, bandsPlugin, cssVar, hourTicks, ignitionOffRanges } from '../core/chart-bands';
import { fmtDateTime, fmtLiters, fmtTime } from '../core/format';
import { currentLang, t } from '../core/i18n/i18n';

Chart.register(LineController, LineElement, PointElement, LinearScale, Filler, Tooltip);

type Point = { x: number; y: number };

const REFUEL_COLOR = '#16a34a'; // --green
const SPEED_COLOR = 'rgba(100, 116, 139, 0.55)'; // --muted

/** Fuel level (left axis) and speed (right axis, faded) of a truck, alerts and engine-off periods as bands */
@Component({
  selector: 'app-truck-chart',
  template: `<canvas
    #canvas
    [attr.aria-label]="t('fleet.truck.chartAria', { plate: truck().plate })"
  ></canvas>`,
  styles: `
    :host {
      display: block;
      position: relative;
      height: 150px;
    }
  `,
})
export class TruckChart {
  readonly truck = input.required<FleetTruck>();
  readonly from = input.required<number>();
  readonly to = input.required<number>();

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private chart: Chart<'line', Point[]> | null = null;

  protected readonly t = t;

  constructor() {
    effect(() => {
      const truck = this.truck();
      const [from, to] = [this.from(), this.to()];
      currentLang(); // axis and tooltip formats follow the language
      this.render(truck, from, to);
    });
    inject(DestroyRef).onDestroy(() => this.chart?.destroy());
  }

  private render(truck: FleetTruck, from: number, to: number) {
    const level = truck.readings.map((r) => ({ x: Date.parse(r.at), y: r.levelL }));
    const speed = truck.readings.map((r) => ({ x: Date.parse(r.at), y: r.speedKmh }));
    const refuels = truck.refuels.map((r) => ({ x: Date.parse(r.at), y: r.liters }));
    const bands: Band[] = [
      ...ignitionOffRanges(truck.readings, cssVar('--off-band')),
      ...truck.alerts.map((a) => ({
        from: Date.parse(a.windowStart),
        to: Date.parse(a.windowEnd),
        color: cssVar('--alert-band'),
      })),
    ];
    // Refuel markers sit on the curve: level of the closest reading after the refuel
    const refuelPoints = refuels.map((r) => ({
      x: r.x,
      y: level.find((p) => p.x >= r.x)?.y ?? level.at(-1)?.y ?? 0,
    }));

    if (this.chart) {
      const [levelSet, speedSet, refuelSet] = this.chart.data.datasets;
      levelSet!.data = level;
      speedSet!.data = speed;
      refuelSet!.data = refuelPoints;
      const options = this.chart.options;
      options.scales!['x']!.min = from;
      options.scales!['x']!.max = to;
      options.scales!['y']!.max = truck.tankCapacityL;
      options.plugins!.bands = { bands };
      this.chart.update('none');
      return;
    }

    this.chart = new Chart(this.canvas().nativeElement, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'level',
            data: level,
            borderColor: cssVar('--accent'),
            backgroundColor: cssVar('--accent-soft'),
            fill: true,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.1,
            yAxisID: 'y',
            order: 1,
          },
          {
            label: 'speed',
            data: speed,
            borderColor: SPEED_COLOR,
            borderWidth: 1,
            pointRadius: 0,
            stepped: true,
            yAxisID: 'speed',
            order: 2,
          },
          {
            label: 'refuel',
            data: refuelPoints,
            showLine: false,
            pointRadius: 5,
            pointHoverRadius: 6,
            pointBackgroundColor: REFUEL_COLOR,
            pointBorderColor: '#fff',
            pointBorderWidth: 1.5,
            yAxisID: 'y',
            order: 0,
          },
        ],
      },
      options: {
        animation: false,
        maintainAspectRatio: false,
        parsing: false,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        scales: {
          x: {
            type: 'linear',
            min: from,
            max: to,
            afterBuildTicks: (axis) => {
              axis.ticks = hourTicks(axis.min, axis.max, 4);
            },
            ticks: { callback: (v) => fmtTime(Number(v)), font: { size: 12 } },
            grid: { display: false },
          },
          y: {
            min: 0,
            max: truck.tankCapacityL,
            ticks: { callback: (v) => `${v} L`, maxTicksLimit: 3, font: { size: 12 } },
          },
          speed: {
            position: 'right',
            min: 0,
            max: 130,
            display: false,
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => fmtDateTime(items[0]?.parsed.x ?? 0),
              label: (item) => {
                const y = item.parsed.y ?? 0;
                switch (item.dataset.label) {
                  case 'level':
                    return `${t('fleet.legend.level')}: ${fmtLiters(y)}`;
                  case 'speed':
                    return `${t('fleet.legend.speed')}: ${Math.round(y)} km/h`;
                  default: {
                    const refuel = this.truck().refuels[item.dataIndex];
                    return t('fleet.truck.refuel', { liters: fmtLiters(refuel?.liters) });
                  }
                }
              },
            },
          },
          bands: { bands },
        },
      },
      plugins: [bandsPlugin as Plugin<'line'>],
    });
  }
}
