import type { RecurrenceRule, TaskPriority } from './constants';
import { getZonedParts, zonedTimeToUtc } from './time';

/**
 * Natural-language quick add.
 *
 *   "Pay rent tomorrow 9am #finance @home !high every month"
 *     -> title "Pay rent", due tomorrow 09:00, tag finance, project "home",
 *        priority high, recurrence monthly
 *
 * Pure and deterministic: callers pass `now` and the zone, which makes it
 * trivially unit-testable and identical on client and server.
 */

export type QuickAddTokenType = 'date' | 'time' | 'priority' | 'tag' | 'project' | 'recurrence';

export interface QuickAddToken {
  type: QuickAddTokenType;
  text: string;
}

export interface QuickAddResult {
  title: string;
  dueAt: Date | null;
  allDay: boolean;
  priority: TaskPriority | null;
  tags: string[];
  project: string | null;
  recurrence: RecurrenceRule | null;
  tokens: QuickAddToken[];
}

interface DateParts {
  year: number;
  month: number;
  day: number;
}

const B = '(?<=^|\\s)'; // token must start at a word boundary made of whitespace
const E = '(?=$|[\\s,.;!?])';

const WEEKDAY_NAMES: Array<[RegExp, number]> = [
  [/^sun(day)?$/, 0],
  [/^mon(day)?$/, 1],
  [/^tue(s(day)?)?$/, 2],
  [/^wed(nesday)?$/, 3],
  [/^thu(r(s(day)?)?)?$/, 4],
  [/^fri(day)?$/, 5],
  [/^sat(urday)?$/, 6],
];
const WEEKDAY_RE = 'sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?';

const FULL_WEEKDAY_RE = 'sunday|monday|tuesday|wednesday|thursday|friday|saturday';

const MONTHS_RE =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const MONTH_INDEX = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const weekdayIndex = (name: string): number => {
  const n = name.toLowerCase();
  return WEEKDAY_NAMES.find(([re]) => re.test(n))?.[1] ?? 1;
};
const monthIndex = (name: string): number => MONTH_INDEX.indexOf(name.toLowerCase().slice(0, 3)) + 1;

const PRIORITY_MAP: Record<string, TaskPriority> = {
  urgent: 'urgent',
  high: 'high',
  medium: 'medium',
  med: 'medium',
  low: 'low',
  p1: 'urgent',
  p2: 'high',
  p3: 'medium',
  p4: 'low',
  '1': 'urgent',
  '2': 'high',
  '3': 'medium',
  '4': 'low',
};

const RECURRENCE_PATTERNS: Array<[RegExp, RecurrenceRule]> = [
  [new RegExp(`${B}(every\\s+weekday|weekdays)${E}`, 'i'), 'weekdays'],
  [new RegExp(`${B}(every\\s+day|daily)${E}`, 'i'), 'daily'],
  [new RegExp(`${B}(every\\s+week|weekly)${E}`, 'i'), 'weekly'],
  [new RegExp(`${B}(every\\s+month|monthly)${E}`, 'i'), 'monthly'],
  [new RegExp(`${B}(every\\s+year|yearly|annually)${E}`, 'i'), 'yearly'],
];

function addDays(d: DateParts, n: number): DateParts {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + n));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

function nextWeekday(today: DateParts, todayWeekday: number, target: number): DateParts {
  const delta = ((target - todayWeekday + 7) % 7) || 7; // always in the future
  return addDays(today, delta);
}

export function parseQuickAdd(input: string, now: Date = new Date(), timeZone = defaultTimeZone()): QuickAddResult {
  let text = ` ${input.replace(/\s+/g, ' ').trim()} `;
  const tokens: QuickAddToken[] = [];
  const zp = getZonedParts(now, timeZone);
  const today: DateParts = { year: zp.year, month: zp.month, day: zp.day };

  let date: DateParts | null = null;
  let time: { hour: number; minute: number } | null = null;
  let recurrence: RecurrenceRule | null = null;
  let priority: TaskPriority | null = null;
  let project: string | null = null;
  const tags: string[] = [];

  /** Remove the first match of `re` and return it, recording a token. */
  const take = (re: RegExp, type: QuickAddTokenType): RegExpExecArray | null => {
    const m = re.exec(text);
    if (!m) return null;
    text = `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`;
    tokens.push({ type, text: m[0].trim() });
    return m;
  };

  // 1. Recurrence ("every monday" also sets the first due date)
  const everyWeekday = take(new RegExp(`${B}every\\s+(${WEEKDAY_RE})${E}`, 'i'), 'recurrence');
  if (everyWeekday) {
    recurrence = 'weekly';
    date = nextWeekday(today, zp.weekday, weekdayIndex(everyWeekday[1]!));
  } else {
    for (const [re, rule] of RECURRENCE_PATTERNS) {
      if (take(re, 'recurrence')) {
        recurrence = rule;
        break;
      }
    }
  }

  // 2. Date phrases — first match wins.
  const datePatterns: Array<[RegExp, (m: RegExpExecArray) => DateParts | null]> = [
    [new RegExp(`${B}(day\\s+after\\s+tomorrow)${E}`, 'i'), () => addDays(today, 2)],
    [new RegExp(`${B}(today)${E}`, 'i'), () => today],
    [
      new RegExp(`${B}(tonight)${E}`, 'i'),
      () => {
        time ??= { hour: 20, minute: 0 };
        return today;
      },
    ],
    [new RegExp(`${B}(tomorrow|tmrw?|tmr)${E}`, 'i'), () => addDays(today, 1)],
    [new RegExp(`${B}(next\\s+week)${E}`, 'i'), () => nextWeekday(today, zp.weekday, 1)],
    [
      new RegExp(`${B}(next\\s+month)${E}`, 'i'),
      () => (today.month === 12 ? { year: today.year + 1, month: 1, day: 1 } : { ...today, month: today.month + 1, day: 1 }),
    ],
    [new RegExp(`${B}((?:this\\s+)?weekend)${E}`, 'i'), () => (zp.weekday === 6 ? today : nextWeekday(today, zp.weekday, 6))],
    [
      new RegExp(`${B}in\\s+(\\d{1,3})\\s+(days?|weeks?|months?)${E}`, 'i'),
      (m) => {
        const n = Number(m[1]);
        const unit = m[2]!.toLowerCase();
        if (unit.startsWith('day')) return addDays(today, n);
        if (unit.startsWith('week')) return addDays(today, n * 7);
        const t = new Date(Date.UTC(today.year, today.month - 1 + n, 1));
        const dim = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
        return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: Math.min(today.day, dim) };
      },
    ],
    [
      new RegExp(`${B}(\\d{4})-(\\d{2})-(\\d{2})${E}`),
      (m) => validDate(Number(m[1]), Number(m[2]), Number(m[3])),
    ],
    [
      new RegExp(`${B}(?:on\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS_RE})${E}`, 'i'),
      (m) => futureMonthDay(today, monthIndex(m[2]!), Number(m[1])),
    ],
    [
      new RegExp(`${B}(?:on\\s+)?(${MONTHS_RE})\\s+(\\d{1,2})(?:st|nd|rd|th)?${E}`, 'i'),
      (m) => futureMonthDay(today, monthIndex(m[1]!), Number(m[2])),
    ],
    [
      // Abbreviations ("sat", "sun") are common English words, so they only count after "on"/"next".
      new RegExp(`${B}(?:(?:on|next)\\s+(${WEEKDAY_RE})|(${FULL_WEEKDAY_RE}))${E}`, 'i'),
      (m) => nextWeekday(today, zp.weekday, weekdayIndex((m[1] ?? m[2])!)),
    ],
  ];
  if (!date) {
    for (const [re, resolve] of datePatterns) {
      const probe = re.exec(text);
      if (!probe) continue;
      const resolved = resolve(probe);
      if (!resolved) continue; // e.g. 2026-02-31 — leave in the title
      take(re, 'date');
      date = resolved;
      break;
    }
  }

  // 3. Time — "at 5pm", "5:30pm", "17:00", "at 9", "noon"
  const noon = take(new RegExp(`${B}(?:at\\s+)?(noon|midday)${E}`, 'i'), 'time');
  if (noon) time = { hour: 12, minute: 0 };
  if (!noon) {
    const ampm = take(new RegExp(`${B}(?:at\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s?(am|pm)${E}`, 'i'), 'time');
    if (ampm) {
      const h = Number(ampm[1]);
      const mm = Number(ampm[2] ?? 0);
      if (h >= 1 && h <= 12 && mm < 60) {
        const pm = ampm[3]!.toLowerCase() === 'pm';
        time = { hour: (h % 12) + (pm ? 12 : 0), minute: mm };
      }
    } else {
      const h24 = take(new RegExp(`${B}(?:at\\s+)?([01]?\\d|2[0-3]):([0-5]\\d)${E}`), 'time');
      if (h24) {
        time = { hour: Number(h24[1]), minute: Number(h24[2]) };
      } else {
        const bare = take(new RegExp(`${B}at\\s+(\\d{1,2})${E}`, 'i'), 'time');
        if (bare) {
          const h = Number(bare[1]);
          // "at 3" almost always means 3pm in a task list; "at 9" means 9am.
          if (h <= 23) time = { hour: h >= 1 && h <= 7 ? h + 12 : h, minute: 0 };
        }
      }
    }
  }

  // 4. Priority
  const pr = take(new RegExp(`${B}!(urgent|high|medium|med|low|p[1-4]|[1-4])${E}`, 'i'), 'priority');
  if (pr) priority = PRIORITY_MAP[pr[1]!.toLowerCase()] ?? null;
  else {
    const p = take(new RegExp(`${B}(p[1-4])${E}`, 'i'), 'priority');
    if (p) priority = PRIORITY_MAP[p[1]!.toLowerCase()] ?? null;
  }

  // 5. Tags (#tag, repeatable) and project (@project, first wins)
  const tagRe = new RegExp(`${B}#([\\p{L}\\p{N}_-]{1,40})${E}`, 'iu');
  for (let m = take(tagRe, 'tag'); m; m = take(tagRe, 'tag')) {
    const t = m[1]!.toLowerCase();
    if (!tags.includes(t)) tags.push(t);
  }
  const proj = take(new RegExp(`${B}@([\\p{L}\\p{N}_-]{1,80})${E}`, 'iu'), 'project');
  if (proj) project = proj[1]!;

  // Resolve the due instant.
  let dueAt: Date | null = null;
  let allDay = false;
  if (date && time) {
    dueAt = zonedTimeToUtc({ ...date, ...time }, timeZone);
  } else if (date) {
    dueAt = zonedTimeToUtc({ ...date, hour: 0, minute: 0 }, timeZone);
    allDay = true;
  } else if (time) {
    let candidate = zonedTimeToUtc({ ...today, ...time }, timeZone);
    if (candidate.getTime() <= now.getTime()) candidate = zonedTimeToUtc({ ...addDays(today, 1), ...time }, timeZone);
    dueAt = candidate;
  } else if (recurrence) {
    // "water plants every day" — start today.
    dueAt = zonedTimeToUtc({ ...today, hour: 0, minute: 0 }, timeZone);
    allDay = true;
  }

  const title = text.replace(/\s+/g, ' ').replace(/\s+([,.;!?])/g, '$1').trim();

  return {
    title: title || input.trim(),
    dueAt,
    allDay,
    priority,
    tags,
    project,
    recurrence,
    tokens,
  };
}

function validDate(year: number, month: number, day: number): DateParts | null {
  if (month < 1 || month > 12 || day < 1) return null;
  const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= dim ? { year, month, day } : null;
}

function futureMonthDay(today: DateParts, month: number, day: number): DateParts | null {
  const thisYear = validDate(today.year, month, day);
  if (!thisYear) return validDate(today.year + 1, month, day);
  const isPast =
    month < today.month || (month === today.month && day < today.day);
  return isPast ? validDate(today.year + 1, month, day) : thisYear;
}

export function defaultTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
