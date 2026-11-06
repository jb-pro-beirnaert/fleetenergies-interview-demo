import {
  buildDropDetails,
  evaluateFuelDrop,
  type RuleReading,
} from './fuel-drop.rule.js';

const T0 = Date.parse('2026-10-14T02:30:00Z');
const reading = (
  minute: number,
  fuelLevelL: number,
  speedKmh = 0,
  ignition = false,
): RuleReading => ({
  recordedAt: new Date(T0 + minute * 60_000),
  fuelLevelL,
  speedKmh,
  ignition,
  lat: 45.2,
  lon: 4.8,
});

describe('evaluateFuelDrop', () => {
  it('detects a 60 L drop while stopped in 12 min', () => {
    const window = [
      reading(0, 400),
      reading(5, 370),
      reading(10, 345),
      reading(12, 340),
    ];
    expect(evaluateFuelDrop(window, 40)).toEqual({
      startAt: window[0].recordedAt,
      endAt: window[3].recordedAt,
      dropL: 60,
    });
  });

  it('ignores a decrease below the threshold', () => {
    expect(
      evaluateFuelDrop([reading(0, 400), reading(10, 361)], 40),
    ).toBeNull();
  });

  it('ignores a decrease while driving (normal consumption or sloshing)', () => {
    const window = [
      reading(0, 400, 80),
      reading(5, 380, 82),
      reading(10, 355, 0),
    ];
    expect(evaluateFuelDrop(window, 40)).toBeNull();
  });

  it('measures from the highest level of the window, the most recent on a tie', () => {
    const window = [
      reading(0, 400, 70),
      reading(5, 400),
      reading(10, 380),
      reading(15, 350),
    ];
    expect(evaluateFuelDrop(window, 40)).toMatchObject({
      startAt: window[1].recordedAt,
      dropL: 50,
    });
  });

  it('raises nothing on an empty window or a single reading', () => {
    expect(evaluateFuelDrop([], 40)).toBeNull();
    expect(evaluateFuelDrop([reading(0, 400)], 40)).toBeNull();
  });
});

describe('buildDropDetails', () => {
  it('summarises the episode', () => {
    const details = buildDropDetails([
      reading(0, 400, 2, true),
      reading(5, 370),
      reading(10, 345),
      reading(15, 340),
    ]);
    expect(details).toEqual({
      levelBeforeL: 400,
      levelAfterL: 340,
      maxSpeedKmh: 2,
      ignitionOffShare: 0.75,
      lat: 45.2,
      lon: 4.8,
    });
  });
});
