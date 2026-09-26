import type { RecurrenceRule } from './constants';
import { getZonedParts, zonedTimeToUtc } from './time';

const daysInMonth = (year: number, month1: number) => new Date(Date.UTC(year, month1, 0)).getUTCDate();

/** Advance a due date by exactly one step of `rule`, preserving wall-clock time in `timeZone`. */
export function stepOccurrence(due: Date, rule: RecurrenceRule, timeZone = 'UTC'): Date {
  const p = getZonedParts(due, timeZone);
  let { year, month, day } = p;

  switch (rule) {
    case 'daily':
      day += 1;
      break;
    case 'weekdays': {
      // Fri -> Mon (+3), Sat -> Mon (+2), otherwise +1
      day += p.weekday === 5 ? 3 : p.weekday === 6 ? 2 : 1;
      break;
    }
    case 'weekly':
      day += 7;
      break;
    case 'monthly': {
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
      day = Math.min(p.day, daysInMonth(year, month)); // Jan 31 -> Feb 28/29
      break;
    }
    case 'yearly':
      year += 1;
      day = Math.min(p.day, daysInMonth(year, month)); // Feb 29 -> Feb 28
      break;
  }

  return zonedTimeToUtc(
    { year, month, day, hour: p.hour, minute: p.minute, second: p.second, millisecond: p.millisecond },
    timeZone,
  );
}

/**
 * Next occurrence strictly after both the current due date and `now`, so that
 * completing an overdue recurring task never spawns another overdue task.
 * Monthly/yearly anchor to the original day-of-month to avoid drift
 * (Jan 31 -> Feb 28 -> Mar 31, not Mar 28).
 */
export function nextOccurrence(due: Date, rule: RecurrenceRule, now: Date = new Date(), timeZone = 'UTC'): Date {
  const anchorDay = getZonedParts(due, timeZone).day;
  let next = due;
  for (let i = 0; i < 1000; i++) {
    next = stepOccurrence(next, rule, timeZone);
    if (rule === 'monthly' || rule === 'yearly') {
      const p = getZonedParts(next, timeZone);
      const wanted = Math.min(anchorDay, daysInMonth(p.year, p.month));
      if (p.day !== wanted) {
        next = zonedTimeToUtc({ ...p, day: wanted }, timeZone);
      }
    }
    if (next.getTime() > now.getTime()) return next;
  }
  return next;
}
