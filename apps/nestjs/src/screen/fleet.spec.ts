import { truckState } from './fleet.js';

const end = new Date('2026-10-14T12:00:00Z');
const at = (minutesBefore: number) =>
  new Date(end.getTime() - minutesBefore * 60_000);

describe('truckState', () => {
  it('no reading or no window → no_data', () => {
    expect(truckState(null, end)).toBe('no_data');
    expect(truckState({ at: end, speedKmh: 80, ignition: true }, null)).toBe(
      'no_data',
    );
  });

  it('reading older than 30 min → no_data', () => {
    expect(truckState({ at: at(35), speedKmh: 80, ignition: true }, end)).toBe(
      'no_data',
    );
  });

  it('moving, idling or parked from the latest reading', () => {
    expect(truckState({ at: at(5), speedKmh: 72, ignition: true }, end)).toBe(
      'moving',
    );
    expect(truckState({ at: at(0), speedKmh: 0, ignition: true }, end)).toBe(
      'idling',
    );
    expect(truckState({ at: at(0), speedKmh: 1, ignition: false }, end)).toBe(
      'parked',
    );
  });
});
