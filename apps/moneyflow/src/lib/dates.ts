/** Date helpers. All display formatting lives here. */

export const TIMEZONE =
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';

export function todayKey(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date());
}

export function currentMonthKey(): string {
  return todayKey().slice(0, 7);
}

export function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split('-').map(Number) as [number, number];
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * First and last day of a month. Hard-coding `-31` produces 2026-09-31, which
 * is not a real date — the API rejects it and the report silently fails.
 */
export function monthBounds(monthKey: string): { from: string; to: string } {
  const [year, month] = monthKey.split('-').map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${monthKey}-01`, to: `${monthKey}-${String(lastDay).padStart(2, '0')}` };
}

export function monthLabel(monthKey: string, style: 'long' | 'short' = 'long'): string {
  const [year, month] = monthKey.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-GB', {
    month: style, year: 'numeric', timeZone: 'UTC',
  });
}

export function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', timeZone: TIMEZONE,
  });
}

/**
 * A readable inclusive range: "1 – 30 September", or "28 Sept – 4 Oct" when it
 * crosses a month. The repeated month is dropped, because reading it twice
 * tells you nothing.
 */
export function rangeLabel(from: string, to: string): string {
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  const startText = start.toLocaleDateString('en-GB', {
    day: 'numeric',
    ...(sameMonth ? {} : { month: 'short' }),
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  });
  const endText = end.toLocaleDateString('en-GB', {
    day: 'numeric', month: sameMonth ? 'long' : 'short', year: 'numeric', timeZone: 'UTC',
  });
  return `${startText} – ${endText}`;
}

export function fullDateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: TIMEZONE,
  });
}

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: TIMEZONE,
  });
}

/** "Today", "Yesterday", or a date — used to group the transaction list. */
export function relativeDayLabel(iso: string): string {
  const key = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date(iso));
  const today = todayKey();
  if (key === today) return 'Today';
  if (key === addDays(today, -1)) return 'Yesterday';
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: TIMEZONE,
  });
}

export function toDateInputValue(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date(iso));
}

export function greeting(name: string): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: TIMEZONE })
      .format(new Date()),
  );
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return `${part}, ${name.split(' ')[0]}`;
}

export const DATE_PRESETS = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'this_week', label: 'This week' },
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'this_year', label: 'This year' },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Custom range' },
] as const;

export type DatePresetId = (typeof DATE_PRESETS)[number]['id'];

export function resolvePreset(preset: DatePresetId): { from?: string; to?: string } {
  const today = todayKey();
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const day = addDays(today, -1);
      return { from: day, to: day };
    }
    case 'this_week': {
      const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
      return { from: addDays(today, -weekday), to: today };
    }
    case 'this_month':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'last_month': {
      const month = shiftMonth(today.slice(0, 7), -1);
      const [y, m] = month.split('-').map(Number) as [number, number];
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
    }
    case 'this_year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case 'all':
    case 'custom':
    default:
      return {};
  }
}
