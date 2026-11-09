import type { ChartType, Plugin } from 'chart.js';

export interface Band {
  from: number;
  to: number;
  color: string;
}

declare module 'chart.js' {
  interface PluginOptionsByType<TType extends ChartType> {
    bands?: { bands: Band[] };
  }
}

/** Vertical coloured bands behind the curves (alert, engine off). Options: `plugins.bands.bands`. */
export const bandsPlugin: Plugin<'line', { bands?: Band[] }> = {
  id: 'bands',
  beforeDatasetsDraw(chart, _args, options) {
    const { ctx, chartArea, scales } = chart;
    const x = scales['x'];
    if (!x) return;
    ctx.save();
    for (const band of options.bands ?? []) {
      const left = Math.max(x.getPixelForValue(band.from), chartArea.left);
      const right = Math.min(x.getPixelForValue(band.to), chartArea.right);
      if (right <= left) continue;
      ctx.fillStyle = band.color;
      ctx.fillRect(left, chartArea.top, right - left, chartArea.bottom - chartArea.top);
    }
    ctx.restore();
  },
};

/** Contiguous ranges where the ignition is off */
export function* ignitionOffRanges(
  points: readonly { at: string; ignition: boolean }[],
  color: string,
): Generator<Band> {
  let start: number | null = null;
  let previous: number | null = null;
  for (const p of points) {
    const t = Date.parse(p.at);
    if (!p.ignition && start === null) start = t;
    if (p.ignition && start !== null) {
      yield { from: start, to: t, color };
      start = null;
    }
    previous = t;
  }
  if (start !== null && previous !== null) yield { from: start, to: previous, color };
}

/** Value of a CSS custom property of the document (chart colours follow the stylesheet) */
export const cssVar = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const HOUR_MS = 3_600_000;
const parisHour = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Paris',
  hour: '2-digit',
  hourCycle: 'h23',
});

/**
 * Time-axis ticks on round Paris hours (every 1, 2, 3, 4, 6 or 12 h, at most `maxTicks`).
 * Use as `afterBuildTicks: (axis) => (axis.ticks = hourTicks(axis.min, axis.max))`.
 */
export function hourTicks(min: number, max: number, maxTicks = 6): { value: number }[] {
  const stepH = [1, 2, 3, 4, 6, 12].find((h) => (max - min) / (h * HOUR_MS) <= maxTicks) ?? 24;
  const ticks: { value: number }[] = [];
  for (let at = Math.ceil(min / HOUR_MS) * HOUR_MS; at <= max; at += HOUR_MS) {
    if (Number(parisHour.format(at)) % stepH === 0) ticks.push({ value: at });
  }
  return ticks;
}
