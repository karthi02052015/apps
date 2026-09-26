/**
 * Calendar arithmetic.
 *
 * Everything the user sees is grouped by *their* calendar day. A purchase at
 * 00:30 belongs to that day, not to the previous UTC one, so every bucketing
 * function takes a timezone and defaults to the browser's own.
 *
 * Two conventions avoid a whole class of off-by-one-day bugs:
 *   • A calendar day is a `YYYY-MM-DD` string, never a `Date`. A `Date` carries
 *     a time and a zone, and "the 23rd" does not.
 *   • Day arithmetic goes through `Date.UTC`, which has no daylight-saving
 *     transitions, so adding one day always adds one day.
 */
import type { DateKey, MonthKey, Timestamp } from './types';

/**
 * Browsers still report legacy IANA aliases — Chromium on a machine set to
 * Indian time says `Asia/Calcutta`, not `Asia/Kolkata`. They behave
 * identically for formatting, but normalising them keeps stored values and
 * exported files consistent.
 */
const TIMEZONE_ALIASES: Record<string, string> = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Dacca': 'Asia/Dhaka',
  'Europe/Kiev': 'Europe/Kyiv',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'America/Godthab': 'America/Nuuk',
  'US/Eastern': 'America/New_York',
  'US/Central': 'America/Chicago',
  'US/Mountain': 'America/Denver',
  'US/Pacific': 'America/Los_Angeles',
};

function detectTimezone(): string {
  try {
    const reported = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return TIMEZONE_ALIASES[reported] ?? reported ?? 'UTC';
  } catch {
    return 'UTC';
  }
}

export const LOCAL_TIMEZONE = detectTimezone();

/** `YYYY-MM-DD` for an instant, in a given timezone. */
export function toDateKey(instant: Date | Timestamp, timeZone = LOCAL_TIMEZONE): DateKey {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

export function toMonthKey(instant: Date | Timestamp, timeZone = LOCAL_TIMEZONE): MonthKey {
  return toDateKey(instant, timeZone).slice(0, 7);
}

export function todayKey(timeZone = LOCAL_TIMEZONE): DateKey {
  return toDateKey(new Date(), timeZone);
}

export function currentMonthKey(timeZone = LOCAL_TIMEZONE): MonthKey {
  return todayKey(timeZone).slice(0, 7);
}

export function isValidDateKey(value: unknown): value is DateKey {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function isValidMonthKey(value: unknown): value is MonthKey {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function addDays(dateKey: DateKey, days: number): DateKey {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function addMonths(dateKey: DateKey, months: number): DateKey {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  // Clamp to the end of the target month: 31 Jan + 1 month is 28 Feb, not 3 Mar.
  const lastDay = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastDay)))
    .toISOString()
    .slice(0, 10);
}

export function addYears(dateKey: DateKey, years: number): DateKey {
  return addMonths(dateKey, years * 12);
}

export function daysBetween(from: DateKey, to: DateKey): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function shiftMonth(monthKey: MonthKey, delta: number): MonthKey {
  const [year, month] = monthKey.split('-').map(Number) as [number, number];
  const base = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** First and last calendar day of a month, inclusive. */
export function monthBounds(monthKey: MonthKey): { from: DateKey; to: DateKey } {
  const [year, month] = monthKey.split('-').map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${monthKey}-01`, to: `${monthKey}-${String(lastDay).padStart(2, '0')}` };
}

/** Monday-based week containing `dateKey`. */
export function weekBounds(dateKey: DateKey): { from: DateKey; to: DateKey } {
  const weekday = (new Date(`${dateKey}T00:00:00Z`).getUTCDay() + 6) % 7;
  const from = addDays(dateKey, -weekday);
  return { from, to: addDays(from, 6) };
}

export function yearBounds(dateKey: DateKey): { from: DateKey; to: DateKey } {
  const year = dateKey.slice(0, 4);
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/** Inclusive list of days between two dates, capped so a bad range cannot hang the UI. */
export function eachDay(from: DateKey, to: DateKey, cap = 800): DateKey[] {
  const out: DateKey[] = [];
  let cursor = from;
  while (cursor <= to && out.length < cap) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

/** Inclusive list of months ending at `endMonth`. */
export function eachMonth(endMonth: MonthKey, count: number): MonthKey[] {
  const out: MonthKey[] = [];
  for (let i = count - 1; i >= 0; i -= 1) out.push(shiftMonth(endMonth, -i));
  return out;
}

/**
 * Turns a date the user picked into an instant.
 *
 * Anchored at 12:00 UTC rather than midnight, so rendering it back in any
 * timezone from UTC−11 to UTC+13 still lands on the day they chose.
 */
export function dateKeyToTimestamp(dateKey: DateKey): Timestamp {
  return `${dateKey}T12:00:00.000Z`;
}

/** True when `timestamp` falls inside an inclusive day range, in `timeZone`. */
export function isWithin(
  timestamp: Timestamp,
  from: DateKey | undefined,
  to: DateKey | undefined,
  timeZone = LOCAL_TIMEZONE,
): boolean {
  const key = toDateKey(timestamp, timeZone);
  if (from && key < from) return false;
  if (to && key > to) return false;
  return true;
}
