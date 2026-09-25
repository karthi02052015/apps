import { describe, expect, it } from 'vitest';
import { startOfZonedWeek, timeZoneOffsetMs, zonedDayBounds, zonedTimeToUtc } from '../src/time';

describe('time helpers', () => {
  it('computes offsets including half-hour zones', () => {
    expect(timeZoneOffsetMs(new Date('2026-09-23T00:00:00Z'), 'Asia/Kolkata')).toBe(5.5 * 3600_000);
  });

  it('day bounds are local midnight to midnight', () => {
    const { start, end } = zonedDayBounds(new Date('2026-09-23T20:00:00Z'), 'Asia/Kolkata');
    expect(start.toISOString()).toBe('2026-09-23T18:30:00.000Z');
    expect(end.toISOString()).toBe('2026-09-24T18:30:00.000Z');
  });

  it('resolves times inside a DST gap forward', () => {
    // 02:30 on 8 Mar 2026 does not exist in New York
    const t = zonedTimeToUtc({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, 'America/New_York');
    expect(t.toISOString()).toBe('2026-03-08T07:30:00.000Z');
  });

  it('weeks start on Monday', () => {
    expect(startOfZonedWeek(new Date('2026-09-27T12:00:00Z'), 'UTC').toISOString()).toBe('2026-09-21T00:00:00.000Z');
  });
});
