import { describe, expect, it } from 'vitest';
import { nextOccurrence, stepOccurrence } from '../src/recurrence';

const d = (s: string) => new Date(s);

describe('stepOccurrence', () => {
  it('daily keeps wall-clock time across a DST change', () => {
    // US DST ends 1 Nov 2026 in New York — 09:00 local must stay 09:00 local.
    const next = stepOccurrence(d('2026-10-31T13:00:00Z'), 'daily', 'America/New_York');
    expect(next.toISOString()).toBe('2026-11-01T14:00:00.000Z');
  });

  it('weekdays skips the weekend', () => {
    expect(stepOccurrence(d('2026-09-25T09:00:00Z'), 'weekdays').toISOString()).toBe('2026-09-28T09:00:00.000Z'); // Fri -> Mon
    expect(stepOccurrence(d('2026-09-23T09:00:00Z'), 'weekdays').toISOString()).toBe('2026-09-24T09:00:00.000Z');
  });

  it('monthly clamps to the end of shorter months', () => {
    expect(stepOccurrence(d('2027-01-31T00:00:00Z'), 'monthly').toISOString()).toBe('2027-02-28T00:00:00.000Z');
  });

  it('yearly handles leap days', () => {
    expect(stepOccurrence(d('2028-02-29T00:00:00Z'), 'yearly').toISOString()).toBe('2029-02-28T00:00:00.000Z');
  });
});

describe('nextOccurrence', () => {
  it('skips forward past now for overdue tasks', () => {
    const next = nextOccurrence(d('2026-09-01T08:00:00Z'), 'daily', d('2026-09-23T10:00:00Z'));
    expect(next.toISOString()).toBe('2026-09-24T08:00:00.000Z');
  });

  it('monthly re-anchors to the original day (no drift)', () => {
    const now = d('2027-02-01T00:00:00Z');
    const feb = nextOccurrence(d('2027-01-31T12:00:00Z'), 'monthly', now);
    expect(feb.toISOString()).toBe('2027-02-28T12:00:00.000Z');
  });
});
