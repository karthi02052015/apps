/**
 * Recurring transactions and subscriptions.
 *
 * Two rules keep this honest:
 *
 *  1. **Occurrences are generated from the start date, not from the previous
 *     occurrence.** A monthly rule starting on the 31st produces 31 Jan,
 *     28 Feb, 31 Mar — clamping only where the month is short. Chaining
 *     "previous + 1 month" instead would permanently drift to the 28th after
 *     one February.
 *
 *  2. **Posting is idempotent.** Each posted occurrence records a
 *     `(recurringId, scheduledFor)` run, and posting skips any pair already
 *     recorded. Opening the app twice on the same day, or importing a backup
 *     that already contains the run, cannot duplicate a transaction.
 */
import type {
  CategoryRef, Database, DateKey, Frequency, MinorUnits, Recurring, RecurringView,
} from './types';
import { addDays, addMonths, addYears, dateKeyToTimestamp, todayKey, LOCAL_TIMEZONE } from './dates';
import { createTransaction, recordRecurringRun } from './operations';

/** Occurrences per year, used only for the monthly/yearly cost estimate. */
const PER_YEAR: Record<Frequency, number> = {
  daily: 365,
  weekly: 52.1775,
  monthly: 12,
  yearly: 1,
};

/** The nth occurrence of a rule, counted from its start date. */
export function occurrenceAt(rule: Pick<Recurring, 'startDate' | 'frequency' | 'intervalCount'>, n: number): DateKey {
  const step = n * rule.intervalCount;
  switch (rule.frequency) {
    case 'daily':
      return addDays(rule.startDate, step);
    case 'weekly':
      return addDays(rule.startDate, step * 7);
    case 'monthly':
      return addMonths(rule.startDate, step);
    default:
      return addYears(rule.startDate, step);
  }
}

/** Roughly how many days one interval spans — used to skip ahead cheaply. */
function approximateStepDays(rule: Pick<Recurring, 'frequency' | 'intervalCount'>): number {
  const perStep = 365 / PER_YEAR[rule.frequency];
  return Math.max(1, perStep * rule.intervalCount);
}

const MAX_STEPS = 5000;

/**
 * The first occurrence strictly after `after`, or `null` when the rule has
 * ended.
 *
 * A long-dormant daily rule could need thousands of steps, so the index is
 * estimated first and then walked back, rather than counted from zero.
 */
export function nextOccurrenceAfter(
  rule: Pick<Recurring, 'startDate' | 'endDate' | 'frequency' | 'intervalCount'>,
  after: DateKey,
): DateKey | null {
  if (after < rule.startDate) {
    return rule.endDate && rule.startDate > rule.endDate ? null : rule.startDate;
  }

  const days = (Date.parse(`${after}T00:00:00Z`) - Date.parse(`${rule.startDate}T00:00:00Z`)) / 86_400_000;
  let n = Math.max(0, Math.floor(days / approximateStepDays(rule)) - 2);

  for (let steps = 0; steps < MAX_STEPS; steps += 1, n += 1) {
    const occurs = occurrenceAt(rule, n);
    if (occurs <= after) continue;
    if (rule.endDate && occurs > rule.endDate) return null;
    return occurs;
  }
  return null;
}

/**
 * Every occurrence from `nextRunOn` up to and including `upTo` that has not
 * already been posted.
 */
export function dueOccurrences(db: Database, rule: Recurring, upTo: DateKey): DateKey[] {
  if (!rule.isActive) return [];
  const posted = new Set(
    db.recurringRuns.filter((run) => run.recurringId === rule.id).map((run) => run.scheduledFor),
  );

  const out: DateKey[] = [];
  let cursor: DateKey | null = rule.nextRunOn ?? rule.startDate;
  for (let guard = 0; cursor && cursor <= upTo && guard < 400; guard += 1) {
    if (rule.endDate && cursor > rule.endDate) break;
    if (!posted.has(cursor)) out.push(cursor);
    cursor = nextOccurrenceAfter(rule, cursor);
  }
  return out;
}

export interface PostResult {
  db: Database;
  posted: number;
  ruleIds: string[];
}

/**
 * Posts every due occurrence of every auto-posting rule.
 *
 * Called once when the app opens and after midnight rolls over. Rules with
 * `autoPost` off are left alone — their occurrences show as "due" in the UI
 * and the user posts them by hand.
 */
export function postDueOccurrences(
  db: Database,
  options: { upTo?: DateKey; timeZone?: string; includeManual?: boolean } = {},
): PostResult {
  const upTo = options.upTo ?? todayKey(options.timeZone ?? LOCAL_TIMEZONE);
  let next = db;
  let posted = 0;
  const ruleIds: string[] = [];

  for (const rule of db.recurring) {
    if (!rule.isActive) continue;
    if (!rule.autoPost && !options.includeManual) continue;

    const due = dueOccurrences(next, rule, upTo);
    if (due.length === 0) continue;

    for (const scheduledFor of due) {
      const created = createTransaction(next, {
        type: rule.type,
        amountMinor: rule.amountMinor,
        accountId: rule.accountId,
        toAccountId: rule.toAccountId,
        categoryId: rule.categoryId,
        description: rule.description,
        notes: rule.notes,
        paymentMethod: rule.paymentMethod,
        occurredAt: dateKeyToTimestamp(scheduledFor),
        source: 'recurring',
        recurringId: rule.id,
      });
      next = recordRecurringRun(
        created.db,
        rule.id,
        scheduledFor,
        created.transaction.id,
        nextOccurrenceAfter(rule, scheduledFor),
      );
      posted += 1;
    }
    ruleIds.push(rule.id);
  }

  return { db: next, posted, ruleIds };
}

/** Posts one specific occurrence, for a rule the user posts by hand. */
export function postOccurrence(db: Database, ruleId: string, scheduledFor: DateKey): Database {
  const rule = db.recurring.find((r) => r.id === ruleId);
  if (!rule) return db;
  const alreadyPosted = db.recurringRuns.some(
    (run) => run.recurringId === ruleId && run.scheduledFor === scheduledFor,
  );
  if (alreadyPosted) return db;

  const created = createTransaction(db, {
    type: rule.type,
    amountMinor: rule.amountMinor,
    accountId: rule.accountId,
    toAccountId: rule.toAccountId,
    categoryId: rule.categoryId,
    description: rule.description,
    notes: rule.notes,
    paymentMethod: rule.paymentMethod,
    occurredAt: dateKeyToTimestamp(scheduledFor),
    source: 'recurring',
    recurringId: rule.id,
  });
  return recordRecurringRun(
    created.db,
    rule.id,
    scheduledFor,
    created.transaction.id,
    nextOccurrenceAfter(rule, scheduledFor),
  );
}

// ── Views ───────────────────────────────────────────────────────────────────

const UNKNOWN_ACCOUNT: CategoryRef = { id: '', name: 'Unknown account', icon: 'wallet', color: 'slate' };

export function toRecurringView(db: Database, rule: Recurring, today: DateKey): RecurringView {
  const perYear = PER_YEAR[rule.frequency] / rule.intervalCount;
  const yearly = Math.round(rule.amountMinor * perYear);
  const account = db.accounts.find((a) => a.id === rule.accountId);
  const toAccount = rule.toAccountId ? db.accounts.find((a) => a.id === rule.toAccountId) : undefined;
  const category = rule.categoryId ? db.categories.find((c) => c.id === rule.categoryId) : undefined;

  return {
    ...rule,
    monthlyEquivalentMinor: Math.round(yearly / 12),
    yearlyEquivalentMinor: yearly,
    category: category
      ? { id: category.id, name: category.name, icon: category.icon, color: category.color }
      : null,
    account: account
      ? { id: account.id, name: account.name, icon: account.icon, color: account.color }
      : UNKNOWN_ACCOUNT,
    toAccount: toAccount ? { id: toAccount.id, name: toAccount.name } : null,
    isDue: Boolean(rule.isActive && rule.nextRunOn && rule.nextRunOn <= today),
  };
}

export function recurringViews(
  db: Database,
  options: { subscriptionsOnly?: boolean; activeOnly?: boolean; today?: DateKey; timeZone?: string } = {},
): RecurringView[] {
  const today = options.today ?? todayKey(options.timeZone ?? LOCAL_TIMEZONE);
  return db.recurring
    .filter((rule) => !options.subscriptionsOnly || rule.isSubscription)
    .filter((rule) => !options.activeOnly || rule.isActive)
    .map((rule) => toRecurringView(db, rule, today))
    .sort((a, b) =>
      Number(b.isActive) - Number(a.isActive) ||
      (a.nextRunOn ?? '9999-12-31').localeCompare(b.nextRunOn ?? '9999-12-31') ||
      a.description.localeCompare(b.description));
}

export interface SubscriptionSummary {
  subscriptions: RecurringView[];
  monthlyTotalMinor: MinorUnits;
  yearlyTotalMinor: MinorUnits;
  activeCount: number;
  upcoming: RecurringView[];
}

export function subscriptionSummary(
  db: Database,
  options: { today?: DateKey; timeZone?: string } = {},
): SubscriptionSummary {
  const subscriptions = recurringViews(db, { ...options, subscriptionsOnly: true });
  const active = subscriptions.filter((s) => s.isActive && s.type === 'expense');
  return {
    subscriptions,
    monthlyTotalMinor: active.reduce((sum, s) => sum + s.monthlyEquivalentMinor, 0),
    yearlyTotalMinor: active.reduce((sum, s) => sum + s.yearlyEquivalentMinor, 0),
    activeCount: active.length,
    upcoming: subscriptions
      .filter((s) => s.isActive && s.nextRunOn)
      .sort((a, b) => (a.nextRunOn ?? '').localeCompare(b.nextRunOn ?? ''))
      .slice(0, 5),
  };
}

/** Rules whose next run has already arrived — what the dashboard warns about. */
export function dueRules(db: Database, today: DateKey): RecurringView[] {
  return recurringViews(db, { today, activeOnly: true }).filter((rule) => rule.isDue);
}
