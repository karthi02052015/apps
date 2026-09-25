import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from '../src/quickAdd';

// Wednesday 23 Sep 2026, 10:00 UTC
const NOW = new Date('2026-09-23T10:00:00.000Z');
const UTC = 'UTC';

describe('parseQuickAdd', () => {
  it('returns the plain title when nothing is recognised', () => {
    const r = parseQuickAdd('Buy 2 apples', NOW, UTC);
    expect(r).toMatchObject({ title: 'Buy 2 apples', dueAt: null, priority: null, tags: [], project: null, recurrence: null });
  });

  it('parses a full sentence with every token type', () => {
    const r = parseQuickAdd('Pay rent tomorrow 9am #finance #Home @personal !high every month', NOW, UTC);
    expect(r.title).toBe('Pay rent');
    expect(r.dueAt?.toISOString()).toBe('2026-09-24T09:00:00.000Z');
    expect(r.allDay).toBe(false);
    expect(r.tags).toEqual(['finance', 'home']);
    expect(r.project).toBe('personal');
    expect(r.priority).toBe('high');
    expect(r.recurrence).toBe('monthly');
    expect(r.tokens.map((t) => t.type).sort()).toEqual(['date', 'priority', 'project', 'recurrence', 'tag', 'tag', 'time']);
  });

  it('treats a date without a time as all-day', () => {
    const r = parseQuickAdd('Dentist friday', NOW, UTC);
    expect(r.dueAt?.toISOString()).toBe('2026-09-25T00:00:00.000Z');
    expect(r.allDay).toBe(true);
  });

  it('does not treat common words like "sun" as weekdays', () => {
    expect(parseQuickAdd('Enjoy the sun', NOW, UTC).dueAt).toBeNull();
    expect(parseQuickAdd('Picnic on sat', NOW, UTC).dueAt?.toISOString()).toBe('2026-09-26T00:00:00.000Z');
  });

  it('rolls a time that already passed today to tomorrow', () => {
    expect(parseQuickAdd('Standup 9:30', NOW, UTC).dueAt?.toISOString()).toBe('2026-09-24T09:30:00.000Z');
    expect(parseQuickAdd('Call at 3', NOW, UTC).dueAt?.toISOString()).toBe('2026-09-23T15:00:00.000Z');
  });

  it('respects the user time zone', () => {
    // 10:00Z = 15:30 in Kolkata; "tonight" = 20:00 IST = 14:30Z
    const r = parseQuickAdd('Read tonight', NOW, 'Asia/Kolkata');
    expect(r.dueAt?.toISOString()).toBe('2026-09-23T14:30:00.000Z');
  });

  it('parses month/day forms and rolls past dates into next year', () => {
    expect(parseQuickAdd('Taxes 15 mar', NOW, UTC).dueAt?.toISOString()).toBe('2027-03-15T00:00:00.000Z');
    expect(parseQuickAdd('Launch Dec 1st', NOW, UTC).dueAt?.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(parseQuickAdd('Ship 2026-10-02 17:00', NOW, UTC).dueAt?.toISOString()).toBe('2026-10-02T17:00:00.000Z');
  });

  it('leaves invalid dates in the title', () => {
    const r = parseQuickAdd('Fix 2026-02-31 bug', NOW, UTC);
    expect(r.dueAt).toBeNull();
    expect(r.title).toBe('Fix 2026-02-31 bug');
  });

  it('handles relative offsets', () => {
    expect(parseQuickAdd('Review in 3 days', NOW, UTC).dueAt?.toISOString()).toBe('2026-09-26T00:00:00.000Z');
    expect(parseQuickAdd('Review in 2 weeks', NOW, UTC).dueAt?.toISOString()).toBe('2026-10-07T00:00:00.000Z');
    expect(parseQuickAdd('Plan next week', NOW, UTC).dueAt?.toISOString()).toBe('2026-09-28T00:00:00.000Z');
  });

  it('"every monday" sets weekly recurrence and the first due date', () => {
    const r = parseQuickAdd('Team sync every monday 10am', NOW, UTC);
    expect(r.recurrence).toBe('weekly');
    expect(r.dueAt?.toISOString()).toBe('2026-09-28T10:00:00.000Z');
    expect(r.title).toBe('Team sync');
  });

  it('recurrence without a date starts today', () => {
    const r = parseQuickAdd('Water plants daily', NOW, UTC);
    expect(r.recurrence).toBe('daily');
    expect(r.dueAt?.toISOString()).toBe('2026-09-23T00:00:00.000Z');
  });

  it('supports p1–p4 priorities', () => {
    expect(parseQuickAdd('Fix prod p1', NOW, UTC).priority).toBe('urgent');
    expect(parseQuickAdd('Tidy !4', NOW, UTC).priority).toBe('low');
  });

  it('never returns an empty title', () => {
    expect(parseQuickAdd('tomorrow', NOW, UTC).title).toBe('tomorrow');
  });
});
