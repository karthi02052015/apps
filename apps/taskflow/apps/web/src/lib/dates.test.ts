import { describe, expect, it } from 'vitest';
import { dueLabel, fromInputs, groupLabel } from './dates';

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const now = at(2026, 9, 23, 10, 0); // Wednesday

describe('dueLabel', () => {
  it('returns null without a due date', () => {
    expect(dueLabel({ dueAt: null, allDay: false, status: 'todo' }, now)).toBeNull();
  });
  it('labels today, tomorrow and weekdays', () => {
    expect(dueLabel({ dueAt: at(2026, 9, 23).toISOString(), allDay: true, status: 'todo' }, now)).toEqual({ label: 'Today', tone: 'today' });
    expect(dueLabel({ dueAt: at(2026, 9, 24).toISOString(), allDay: true, status: 'todo' }, now)?.label).toBe('Tomorrow');
    expect(dueLabel({ dueAt: at(2026, 9, 25).toISOString(), allDay: true, status: 'todo' }, now)?.label).toBe('Fri');
  });
  it('flags overdue timed and all-day tasks', () => {
    expect(dueLabel({ dueAt: at(2026, 9, 23, 9).toISOString(), allDay: false, status: 'todo' }, now)?.tone).toBe('overdue');
    expect(dueLabel({ dueAt: at(2026, 9, 22).toISOString(), allDay: true, status: 'todo' }, now)).toMatchObject({ label: 'Yesterday', tone: 'overdue' });
    expect(dueLabel({ dueAt: at(2026, 9, 22).toISOString(), allDay: true, status: 'done' }, now)?.tone).toBe('done');
  });
});

describe('fromInputs', () => {
  it('builds all-day and timed instants in local time', () => {
    expect(fromInputs('', '')).toEqual({ dueAt: null, allDay: false });
    expect(fromInputs('2026-10-02', '')).toEqual({ dueAt: at(2026, 10, 2).toISOString(), allDay: true });
    expect(fromInputs('2026-10-02', '17:30')).toEqual({ dueAt: at(2026, 10, 2, 17, 30).toISOString(), allDay: false });
  });
});

describe('groupLabel', () => {
  it('groups by relative day', () => {
    expect(groupLabel(null, now)).toBe('No date');
    expect(groupLabel(at(2026, 9, 24).toISOString(), now)).toBe('Tomorrow');
    expect(groupLabel(at(2026, 9, 26).toISOString(), now)).toBe('Saturday');
  });
});
