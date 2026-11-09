import { hourTicks } from './chart-bands';

describe('hourTicks', () => {
  it('ticks on round Paris hours, step chosen to stay under the limit', () => {
    // 09/11/2026: Paris = UTC+1
    const min = Date.parse('2026-11-08T10:55:00Z'); // 11:55 Paris
    const max = Date.parse('2026-11-09T10:55:00Z');
    const ticks = hourTicks(min, max, 6);
    expect(ticks).toHaveLength(6); // every 4 h: 12:00, 16:00, … 08:00
    expect(new Date(ticks[0]!.value).toISOString()).toBe('2026-11-08T11:00:00.000Z');
    expect(ticks[1]!.value - ticks[0]!.value).toBe(4 * 3_600_000);
  });
});
