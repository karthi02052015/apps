/**
 * Dependency-free, DST-correct time-zone helpers built on Intl.
 *
 * Why not a library? The API needs only "wall-clock parts in zone X" and
 * "wall-clock parts in zone X -> UTC instant". Both are ~40 lines on top of
 * Intl, avoiding a large dependency in both bundles.
 */

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();
/** Hard cap: the set of real zones is ~600, so this only trips under abuse. */
const FORMATTER_CACHE_MAX = 1_000;
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * Canonical IANA name for a user-supplied zone ("aSiA/kOlKaTa" -> "Asia/Calcutta"),
 * or null if unknown. Always canonicalise untrusted input before caching on it —
 * otherwise case variants of one zone would each allocate a formatter.
 */
export function canonicalTimeZone(timeZone: string): string | null {
  if (!timeZone || timeZone.length > 64) return null;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

function formatterFor(rawTimeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(rawTimeZone);
  if (f) return f;
  const timeZone = canonicalTimeZone(rawTimeZone);
  if (!timeZone) throw new RangeError(`Invalid time zone: ${rawTimeZone}`);
  f = formatterCache.get(timeZone);
  if (!f) {
    if (formatterCache.size >= FORMATTER_CACHE_MAX) formatterCache.clear();
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatterCache.set(timeZone, f);
  }
  // Only alias the raw spelling when it already is canonical — keeps the cache bounded.
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  return canonicalTimeZone(timeZone) !== null;
}

export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts: Record<string, string> = {};
  for (const p of formatterFor(timeZone).formatToParts(date)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    millisecond: date.getUTCMilliseconds(),
    weekday: WEEKDAYS[parts.weekday ?? 'Sun'] ?? 0,
  };
}

/** Offset of `timeZone` from UTC at `date`, in milliseconds (e.g. +05:30 -> 19_800_000). */
export function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const p = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, p.millisecond);
  return asUtc - date.getTime();
}

/**
 * Convert wall-clock time in `timeZone` to a UTC instant. Out-of-range fields
 * (day 32, hour 25…) roll over like Date.UTC. Times inside a DST gap resolve
 * forward; ambiguous times resolve to the earlier instant.
 */
export function zonedTimeToUtc(
  p: Pick<ZonedParts, 'year' | 'month' | 'day'> & Partial<Pick<ZonedParts, 'hour' | 'minute' | 'second' | 'millisecond'>>,
  timeZone: string,
): Date {
  const guess = Date.UTC(p.year, p.month - 1, p.day, p.hour ?? 0, p.minute ?? 0, p.second ?? 0, p.millisecond ?? 0);
  const offset1 = timeZoneOffsetMs(new Date(guess), timeZone);
  const first = guess - offset1;
  const offset2 = timeZoneOffsetMs(new Date(first), timeZone);
  if (offset2 === offset1) return new Date(first);
  // Offsets disagree: we are near a transition. Prefer the candidate that
  // round-trips; if neither does, the wall time is in a DST gap and `first`
  // (the later instant) is the forward-resolved time.
  const second = guess - offset2;
  return new Date(timeZoneOffsetMs(new Date(second), timeZone) === offset2 ? second : first);
}

export function startOfZonedDay(date: Date, timeZone: string, addDays = 0): Date {
  const p = getZonedParts(date, timeZone);
  return zonedTimeToUtc({ year: p.year, month: p.month, day: p.day + addDays }, timeZone);
}

/** Half-open [start, end) bounds of the calendar day containing `date` in `timeZone`. */
export function zonedDayBounds(date: Date, timeZone: string): { start: Date; end: Date } {
  return { start: startOfZonedDay(date, timeZone), end: startOfZonedDay(date, timeZone, 1) };
}

/** Monday 00:00 of the week containing `date` in `timeZone`. */
export function startOfZonedWeek(date: Date, timeZone: string): Date {
  const p = getZonedParts(date, timeZone);
  const sinceMonday = (p.weekday + 6) % 7;
  return zonedTimeToUtc({ year: p.year, month: p.month, day: p.day - sinceMonday }, timeZone);
}

/** Calendar-day key (YYYY-MM-DD) of an instant in a zone. */
export function zonedDateKey(date: Date, timeZone: string): string {
  const p = getZonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
