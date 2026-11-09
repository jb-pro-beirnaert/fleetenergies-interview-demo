import type { FleetOverview, FleetReading, FleetTruck } from '@fleet/contracts';
import { activitySeries } from './fleet-activity-chart';

const T0 = Date.parse('2026-10-14T08:00:00Z');
const reading = (minute: number, speedKmh: number, ignition: boolean): FleetReading => ({
  at: new Date(T0 + minute * 60_000).toISOString(),
  lat: 43.3,
  lon: 5.4,
  speedKmh,
  ignition,
  levelL: 400,
});
const truck = (readings: FleetReading[]) => ({ readings }) as unknown as FleetTruck;

describe('activitySeries', () => {
  it('counts the trucks per state at each 5-min step', () => {
    const overview = {
      trucks: [
        truck([reading(0, 80, true), reading(5, 0, true)]),
        // a few seconds off the grid: same step
        truck([
          { ...reading(0, 0, false), at: new Date(T0 + 4_000).toISOString() },
          reading(5, 0, false),
        ]),
      ],
    } as unknown as FleetOverview;

    const series = activitySeries(overview);
    expect(series.moving).toEqual([
      { x: T0, y: 1 },
      { x: T0 + 300_000, y: 0 },
    ]);
    expect(series.idling.map((p) => p.y)).toEqual([0, 1]);
    expect(series.parked.map((p) => p.y)).toEqual([1, 1]);
  });
});
