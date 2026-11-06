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

describe('computeFuelBalance (relevés construits à la main)', () => {
  // 0-60 min : 80 km/h, 80 km parcourus ; 60-120 min : arrêt moteur tournant ;
  // 120-130 min : chute de 100 L moteur coupé.
  const readings: Reading[] = [
    reading(0, 500, { speedKmh: 80, odometerKm: 1000 }),
    reading(30, 488, { speedKmh: 80, odometerKm: 1040 }),
    reading(60, 476, { speedKmh: 0, odometerKm: 1080 }),
    reading(90, 474.5, { odometerKm: 1080 }),
    reading(120, 473, { odometerKm: 1080 }),
    reading(130, 373, { odometerKm: 1080, ignition: false }),
  ];

  it('calcule attendu, observé et inexpliqué', () => {
    const balance = computeFuelBalance({
      readings,
      refueledL: 0,
      baselineLPer100km: 30,
      idleLPerHour: 3,
    });
    // Ralenti : 60→90 et 90→120 (arrêt, contact mis) = 1 h ; 120→130 ne compte pas (contact coupé à 130)
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

  it('ajoute les pleins à la baisse observée', () => {
    const balance = computeFuelBalance({
      readings,
      refueledL: 250.04,
      baselineLPer100km: 30,
      idleLPerHour: 3,
    });
    expect(balance.refueledL).toBe(250);
    expect(balance.unexplainedLossL).toBe(350);
  });

  it('idleHours ne compte que l’arrêt moteur tournant', () => {
    expect(idleHours(readings)).toBe(1);
  });
});

describe('findLevelChanges', () => {
  it('trouve la plus forte chute à l’arrêt en ≤ 20 min', () => {
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

  it('ignore une chute qui traverse un trajet', () => {
    const readings = [
      reading(0, 400),
      reading(5, 380, { speedKmh: 70 }),
      reading(10, 340),
    ];
    expect(findLevelChanges(readings, 'drop', 25)).toEqual([]);
  });

  it('ne compte pas deux fois des chutes qui se chevauchent', () => {
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

  it('signale une remontée sans plein (artefact de sonde)', () => {
    expect(findRecoveries(readings, [])).toEqual([
      { at: at(15).toISOString(), liters: 88 },
    ]);
  });

  it('ignore une remontée expliquée par un plein à ± 30 min', () => {
    expect(findRecoveries(readings, [at(40)])).toEqual([]);
  });
});

describe('downsample', () => {
  it('renvoie la série telle quelle sous 30 points', () => {
    const points = [1, 2, 3];
    expect(downsample(points, (p) => p)).toBe(points);
  });

  it('garde au plus 30 points dont premier, dernier, min et max', () => {
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

describe('arrêts et activité', () => {
  const readings = [
    reading(0, 400, { speedKmh: 80, odometerKm: 100 }),
    reading(5, 398, { speedKmh: 0, odometerKm: 106, ignition: false }),
    reading(10, 398, { ignition: false, odometerKm: 106 }),
    reading(15, 398, { ignition: true, odometerKm: 106 }),
    reading(20, 396, { speedKmh: 75, odometerKm: 112 }),
    reading(25, 395, { speedKmh: 1, odometerKm: 113 }),
    reading(30, 394, { speedKmh: 70, odometerKm: 119 }),
  ];

  it('un arrêt dure au moins 5 min ; moteur coupé à la majorité des relevés', () => {
    const stops = findStops(readings);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ durationMin: 10, ignitionOff: true });
    expect(stops[0].from.at).toEqual(at(5));
  });

  it('compte les minutes en mouvement', () => {
    expect(movingMinutes(readings)).toBe(10);
  });

  it('longestStops garde les plus longs dans l’ordre chronologique', () => {
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
      name: 'Dépôt Avignon',
      type: 'depot',
      lat: 43.95,
      lon: 4.8,
      radiusM: 300,
    },
  ];

  it('rattache une position au lieu dont le rayon la contient', () => {
    expect(nearestPlace({ lat: 44.9005, lon: 4.9 }, places)?.name).toBe(
      'AS24 Valence Sud',
    );
  });

  it('renvoie null hors de tout rayon', () => {
    expect(nearestPlace({ lat: 44.91, lon: 4.9 }, places)).toBeNull();
  });
});

describe('hourOfDayParis', () => {
  it('donne l’heure française (UTC+2 en octobre)', () => {
    expect(hourOfDayParis(new Date('2026-10-14T00:35:00Z'))).toBe(2);
  });
});
