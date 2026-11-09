import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import type { AlertDetail, TankCurve, TankCurvePoints } from '@fleet/contracts';
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
import { ApiService } from '../../core/api.service';
import { type Band, bandsPlugin, cssVar, ignitionOffRanges } from '../../core/chart-bands';
import { fmtDateTime, fmtLiters, fmtMinutes, fmtTime } from '../../core/format';
import { currentLang, t } from '../../core/i18n/i18n';
import { TOOL_STYLES } from './tool-styles';
import { isRecord, toolWindow } from './tool-window';

Chart.register(LineController, LineElement, PointElement, LinearScale, Filler, Tooltip);

@Component({
  selector: 'app-tank-curve-view',
  template: `
    <div class="chart">
      <canvas #canvas [attr.aria-label]="t('tools.tank.aria')"></canvas>
      @if (points.isLoading() && !points.hasValue()) {
        <span class="overlay">{{ t('tools.tank.loading') }}</span>
      } @else if (points.error()) {
        <span class="overlay">{{ t('tools.tank.unavailable') }}</span>
      }
    </div>
    <div class="legend">
      <span><i class="sw alert"></i>{{ t('tools.tank.legendAlert') }}</span>
      <span><i class="sw off"></i>{{ t('tools.tank.legendOff') }}</span>
    </div>
    @if (summary(); as s) {
      <div class="summary">
        <span
          >{{ t('tools.tank.start') }} <strong>{{ fmtLiters(s.startLevelL) }}</strong></span
        >
        <span
          >{{ t('tools.tank.end') }} <strong>{{ fmtLiters(s.endLevelL) }}</strong></span
        >
        @if (s.biggestDrop; as d) {
          <span>
            {{ t('tools.tank.biggestDrop') }}
            <strong class="drop">−{{ fmtLiters(d.liters) }}</strong> {{ fmtTime(d.from) }}–{{
              fmtTime(d.to)
            }}
            ({{ fmtMinutes(d.durationMin) }}{{ d.ignitionOff ? ', ' + t('common.engineOff') : '' }})
          </span>
        }
        @if (s.recoveries.length) {
          <span>
            {{ t('tools.tank.recoveries') }}
            @for (r of s.recoveries; track $index) {
              <strong>+{{ fmtLiters(r.liters) }}</strong> {{ t('tools.tank.at') }} {{ fmtTime(r.at)
              }}{{ $last ? '' : ', ' }}
            }
          </span>
        }
      </div>
    }
  `,
  styles: [
    TOOL_STYLES,
    `
      .chart {
        position: relative;
        height: 220px;
      }
      .overlay {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--muted);
      }
      .legend {
        display: flex;
        gap: 16px;
        font-size: 13px;
        color: var(--muted);
        margin-top: 4px;
      }
      .sw {
        display: inline-block;
        width: 12px;
        height: 12px;
        border-radius: 3px;
        margin-right: 6px;
        vertical-align: -1px;
      }
      .sw.alert {
        background: color-mix(in srgb, var(--red) 22%, transparent);
      }
      .sw.off {
        background: color-mix(in srgb, var(--muted) 22%, transparent);
      }
      .summary {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 18px;
        margin-top: 8px;
        font-variant-numeric: tabular-nums;
      }
      .drop {
        color: var(--red);
      }
    `,
  ],
})
export class TankCurveView {
  private readonly api = inject(ApiService);

  readonly result = input.required<unknown>();
  readonly alert = input.required<AlertDetail>();
  readonly args = input.required<Record<string, unknown>>();

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly window = toolWindow(this.alert, this.args);
  private readonly alertWindow = computed(
    () => ({ from: Date.parse(this.alert().windowStart), to: Date.parse(this.alert().windowEnd) }),
    { equal: (a, b) => a.from === b.from && a.to === b.to },
  );

  protected readonly points = rxResource({
    params: () => this.window(),
    stream: ({ params }) => this.api.tankCurve(params.truckId, params),
  });

  protected readonly summary = computed(() => {
    const r = this.result();
    return isRecord(r) && typeof r['startLevelL'] === 'number' ? (r as TankCurve) : null;
  });

  protected readonly fmtLiters = fmtLiters;
  protected readonly fmtTime = fmtTime;
  protected readonly fmtMinutes = fmtMinutes;
  protected readonly t = t;

  private chart: Chart<'line', { x: number; y: number }[]> | null = null;

  constructor() {
    effect(() => {
      const points = this.points.hasValue() ? this.points.value() : null;
      currentLang(); // the axis and tooltip formats follow the language
      if (points) this.render(points);
    });
    inject(DestroyRef).onDestroy(() => this.chart?.destroy());
  }

  private render(points: TankCurvePoints) {
    const data = points.map((p) => ({ x: Date.parse(p.at), y: p.levelL }));
    const bands: Band[] = [...ignitionOffRanges(points, cssVar('--off-band'))];
    const alert = this.alertWindow();
    bands.push({ ...alert, color: cssVar('--alert-band') });

    this.chart?.destroy();
    const window = this.window();
    this.chart = new Chart(this.canvas().nativeElement, {
      type: 'line',
      data: {
        datasets: [
          {
            data,
            borderColor: cssVar('--accent'),
            backgroundColor: cssVar('--accent-soft'),
            fill: true,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.15,
          },
        ],
      },
      options: {
        animation: false,
        maintainAspectRatio: false,
        parsing: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            type: 'linear',
            min: Date.parse(window.from),
            max: Date.parse(window.to),
            ticks: {
              callback: (value) => fmtTime(Number(value)),
              maxTicksLimit: 8,
              font: { size: 13 },
            },
            grid: { display: false },
          },
          y: {
            min: 0,
            suggestedMax: this.alert().truck.tankCapacityL,
            ticks: { callback: (value) => `${value} L`, font: { size: 13 } },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => fmtDateTime(items[0]?.parsed.x ?? 0),
              label: (item) => fmtLiters(item.parsed.y),
            },
          },
          bands: { bands },
        },
      },
      plugins: [bandsPlugin as Plugin<'line'>],
    });
  }
}
