import {
  computeFuelBalance,
  downsample,
  findLevelChanges,
  findRecoveries,
  findStops,
  hourOfDayParis,
  idleHours,
  longestStops,
  movingMinutes,
  nearestPlace,
  type Reading,
} from './calculations.js';

const T0 = Date.parse('2026-10-14T06:00:00Z');
const at = (minute: number) => new Date(T0 + minute * 60_000);

function reading(
  minute: number,
  fuelLevelL: number,
  {
    speedKmh = 0,
    ignition = true,
    odometerKm = 1000,
    lat = 45,
    lon = 4.8,
  } = {},
): Reading {
  return {
    at: at(minute),
    fuelLevelL,
    speedKmh,
    ignition,
    odometerKm,
    lat,
    lon,
  };
}

describe('computeFuelBalance (hand-built readings)', () => {
  // 0-60 min: 80 km/h, 80 km driven; 60-120 min: stopped, engine running;
  // 120-130 min: 100 L drop, engine off.
  const readings: Reading[] = [
    reading(0, 500, { speedKmh: 80, odometerKm: 1000 }),
    reading(30, 488, { speedKmh: 80, odometerKm: 1040 }),
    reading(60, 476, { speedKmh: 0, odometerKm: 1080 }),
    reading(90, 474.5, { odometerKm: 1080 }),
    reading(120, 473, { odometerKm: 1080 }),
    reading(130, 373, { odometerKm: 1080, ignition: false }),
  ];

  it('computes expected, observed and unexplained', () => {
    const balance = computeFuelBalance({
      readings,
      refueledL: 0,
      baselineLPer100km: 30,
      idleLPerHour: 3,
    });
    // Idle: 60→90 and 90→120 (stopped, ignition on) = 1 h; 120→130 does not count (ignition off at 130)
    expect(balance).toEqual({
      distanceKm: 80,
      movingConsumptionL: 24,
      idleConsumptionL: 3,
      expectedConsumptionL: 27,
      refueledL: 0,
      observedLevelChangeL: 127,
      unexplainedLossL: 100,
    });
  });

  it('adds the refuels to the observed decrease', () => {
    const balance = computeFuelBalance({
      readings,
      refueledL: 250.04,
      baselineLPer100km: 30,
      idleLPerHour: 3,
    });
    expect(balance.refueledL).toBe(250);
    expect(balance.unexplainedLossL).toBe(350);
  });

  it('idleHours only counts stops with the engine running', () => {
    expect(idleHours(readings)).toBe(1);
  });
});

describe('findLevelChanges', () => {
  it('finds the biggest drop while stopped in ≤ 20 min', () => {
    const readings = [
      reading(0, 400),
      reading(5, 395),
      reading(10, 300, { ignition: false }),
      reading(15, 220, { ignition: false }),
      reading(40, 215),
    ];
    const [drop] = findLevelChanges(readings, 'drop', 25);
    expect(drop.liters).toBe(180);
    expect(drop.from.at).toEqual(at(0));
    expect(drop.to.at).toEqual(at(15));
  });

  it('ignores a drop that spans a trip', () => {
    const readings = [
      reading(0, 400),
      reading(5, 380, { speedKmh: 70 }),
      reading(10, 340),
    ];
    expect(findLevelChanges(readings, 'drop', 25)).toEqual([]);
  });

  it('does not count overlapping drops twice', () => {
    const readings = [
      reading(0, 400),
      reading(5, 370),
      reading(10, 340),
      reading(60, 340),
      reading(65, 300),
    ];
    expect(findLevelChanges(readings, 'drop', 25).map((d) => d.liters)).toEqual(
      [60, 40],
    );
  });
});

describe('findRecoveries', () => {
  const readings = [reading(0, 400), reading(5, 310), reading(15, 398)];

  it('flags a rise without a refuel (sensor artefact)', () => {
    expect(findRecoveries(readings, [])).toEqual([
      { at: at(15).toISOString(), liters: 88 },
    ]);
  });

  it('ignores a rise explained by a refuel within ± 30 min', () => {
    expect(findRecoveries(readings, [at(40)])).toEqual([]);
  });
});

describe('downsample', () => {
  it('returns the series as is under 30 points', () => {
    const points = [1, 2, 3];
    expect(downsample(points, (p) => p)).toBe(points);
  });

  it('keeps at most 30 points including first, last, min and max', () => {
    const points = Array.from({ length: 288 }, (_, i) => ({
      i,
      v: Math.sin(i / 10) * 100 + i,
    }));
    points[150].v = -500;
    points[200].v = 900;
    const sampled = downsample(points, (p) => p.v);
    expect(sampled.length).toBeLessThanOrEqual(30);
    expect(sampled[0]).toBe(points[0]);
    expect(sampled.at(-1)).toBe(points.at(-1));
    expect(sampled).toContain(points[150]);
    expect(sampled).toContain(points[200]);
    expect(sampled.map((p) => p.i)).toEqual(
      sampled.map((p) => p.i).sort((a, b) => a - b),
    );
  });
});

describe('stops and activity', () => {
  const readings = [
    reading(0, 400, { speedKmh: 80, odometerKm: 100 }),
    reading(5, 398, { speedKmh: 0, odometerKm: 106, ignition: false }),
    reading(10, 398, { ignition: false, odometerKm: 106 }),
    reading(15, 398, { ignition: true, odometerKm: 106 }),
    reading(20, 396, { speedKmh: 75, odometerKm: 112 }),
    reading(25, 395, { speedKmh: 1, odometerKm: 113 }),
    reading(30, 394, { speedKmh: 70, odometerKm: 119 }),
  ];

  it('a stop lasts at least 5 min; engine off by majority of readings', () => {
    const stops = findStops(readings);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ durationMin: 10, ignitionOff: true });
    expect(stops[0].from.at).toEqual(at(5));
  });

  it('counts the minutes moving', () => {
    expect(movingMinutes(readings)).toBe(10);
  });

  it('longestStops keeps the longest ones in chronological order', () => {
    const stops = [
      { durationMin: 5, from: { at: at(0) } },
      { durationMin: 50, from: { at: at(10) } },
      { durationMin: 30, from: { at: at(20) } },
    ] as Parameters<typeof longestStops>[0];
    expect(longestStops(stops, 2).map((s) => s.durationMin)).toEqual([50, 30]);
  });
});

describe('nearestPlace', () => {
  const places = [
    {
      name: 'AS24 Valence Sud',
      type: 'fuel_station',
      lat: 44.9,
      lon: 4.9,
      radiusM: 150,
    },
    {
      name: 'Avignon depot',
      type: 'depot',
      lat: 43.95,
      lon: 4.8,
      radiusM: 300,
    },
  ];

  it('links a position to the place whose radius contains it', () => {
    expect(nearestPlace({ lat: 44.9005, lon: 4.9 }, places)?.name).toBe(
      'AS24 Valence Sud',
    );
  });

  it('returns null outside every radius', () => {
    expect(nearestPlace({ lat: 44.91, lon: 4.9 }, places)).toBeNull();
  });
});

describe('hourOfDayParis', () => {
  it('gives the French hour (UTC+2 in October)', () => {
    expect(hourOfDayParis(new Date('2026-10-14T00:35:00Z'))).toBe(2);
  });
});
