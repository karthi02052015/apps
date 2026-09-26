/**
 * Analytics.
 *
 * Every figure is computed from the ledger on demand. Three rules hold
 * throughout:
 *
 *   1. Transfers are excluded from every income/expense aggregate. They appear
 *      only in balance timelines, where the two legs correctly net to zero.
 *   2. Bucketing happens in the user's own timezone, so a late-night purchase
 *      lands on the day they think it did.
 *   3. Sums are over integer minor units. Percentages are basis points, so a
 *      share is exact and never a float.
 */
import { ratioBps } from './money';
import {
  LOCAL_TIMEZONE, eachDay, eachMonth, monthBounds, shiftMonth, toDateKey, todayKey,
} from './dates';
import { signedAmount } from './ledger';
import type {
  BalancePoint, CategorySlice, DailyPoint, Database, DateKey, DateRange, MinorUnits,
  MonthKey, MonthlyPoint, PeriodTotals, Transaction,
} from './types';

const EMPTY_TOTALS: PeriodTotals = {
  incomeMinor: 0, expenseMinor: 0, adjustmentMinor: 0, transferMinor: 0,
  netMinor: 0, incomeCount: 0, expenseCount: 0,
};

/** Day key for a transaction, in the given timezone. Hot path, so it is cached. */
function dayKeyer(timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const cache = new Map<string, DateKey>();
  return (timestamp: string): DateKey => {
    const hit = cache.get(timestamp);
    if (hit) return hit;
    const key = formatter.format(new Date(timestamp));
    cache.set(timestamp, key);
    return key;
  };
}

export function inRange(
  transactions: Transaction[],
  range: DateRange,
  timeZone = LOCAL_TIMEZONE,
): Transaction[] {
  const keyOf = dayKeyer(timeZone);
  return transactions.filter((transaction) => {
    const day = keyOf(transaction.occurredAt);
    return day >= range.from && day <= range.to;
  });
}

export function periodTotals(
  db: Database,
  range: DateRange,
  timeZone = LOCAL_TIMEZONE,
): PeriodTotals {
  const totals: PeriodTotals = { ...EMPTY_TOTALS };
  for (const transaction of inRange(db.transactions, range, timeZone)) {
    switch (transaction.type) {
      case 'income':
        totals.incomeMinor += transaction.amountMinor;
        totals.incomeCount += 1;
        break;
      case 'expense':
        totals.expenseMinor += transaction.amountMinor;
        totals.expenseCount += 1;
        break;
      case 'adjustment':
        totals.adjustmentMinor += transaction.amountMinor;
        break;
      case 'transfer':
        totals.transferMinor += transaction.amountMinor;
        break;
    }
  }
  // Adjustments are real changes to net worth, so they belong in the net.
  totals.netMinor = totals.incomeMinor - totals.expenseMinor + totals.adjustmentMinor;
  return totals;
}

/** All-time income, expenses and net, for the headline cards. */
export function lifetimeTotals(db: Database): {
  receivedMinor: MinorUnits;
  spentMinor: MinorUnits;
  savedMinor: MinorUnits;
  transactionCount: number;
} {
  let receivedMinor = 0;
  let spentMinor = 0;
  let adjustment = 0;
  for (const transaction of db.transactions) {
    if (transaction.type === 'income') receivedMinor += transaction.amountMinor;
    else if (transaction.type === 'expense') spentMinor += transaction.amountMinor;
    else if (transaction.type === 'adjustment') adjustment += transaction.amountMinor;
  }
  return {
    receivedMinor,
    spentMinor,
    savedMinor: receivedMinor - spentMinor + adjustment,
    transactionCount: db.transactions.length,
  };
}

export function categoryBreakdown(
  db: Database,
  range: DateRange,
  kind: 'expense' | 'income' = 'expense',
  timeZone = LOCAL_TIMEZONE,
): CategorySlice[] {
  const totals = new Map<string, { amount: MinorUnits; count: number }>();
  for (const transaction of inRange(db.transactions, range, timeZone)) {
    if (transaction.type !== kind || !transaction.categoryId) continue;
    const current = totals.get(transaction.categoryId) ?? { amount: 0, count: 0 };
    current.amount += transaction.amountMinor;
    current.count += 1;
    totals.set(transaction.categoryId, current);
  }

  const grandTotal = [...totals.values()].reduce((sum, item) => sum + item.amount, 0);
  const byId = new Map(db.categories.map((c) => [c.id, c]));

  return [...totals.entries()]
    .map(([categoryId, item]) => {
      const category = byId.get(categoryId);
      return {
        categoryId,
        name: category?.name ?? 'Uncategorised',
        icon: category?.icon ?? 'tag',
        color: category?.color ?? 'slate',
        amountMinor: item.amount,
        transactionCount: item.count,
        shareBps: ratioBps(item.amount, grandTotal),
      };
    })
    // Name breaks the tie, so two equal categories keep a stable order between
    // renders instead of the legend and the donut swapping around.
    .sort((a, b) => b.amountMinor - a.amountMinor || a.name.localeCompare(b.name));
}

/** Day-by-day series across the window, including days with no activity. */
export function dailySeries(
  db: Database,
  range: DateRange,
  timeZone = LOCAL_TIMEZONE,
): DailyPoint[] {
  const buckets = new Map<DateKey, DailyPoint>();
  for (const date of eachDay(range.from, range.to)) {
    buckets.set(date, { date, incomeMinor: 0, expenseMinor: 0, netMinor: 0, transactionCount: 0 });
  }

  const keyOf = dayKeyer(timeZone);
  for (const transaction of db.transactions) {
    const bucket = buckets.get(keyOf(transaction.occurredAt));
    if (!bucket) continue;
    bucket.transactionCount += 1;
    if (transaction.type === 'income') bucket.incomeMinor += transaction.amountMinor;
    else if (transaction.type === 'expense') bucket.expenseMinor += transaction.amountMinor;
    bucket.netMinor += signedAmount(transaction.type, transaction.amountMinor);
  }

  return [...buckets.values()];
}

/** Month-by-month series ending at `endMonth`, filling empty months. */
export function monthlySeries(
  db: Database,
  endMonth: MonthKey,
  months: number,
  timeZone = LOCAL_TIMEZONE,
): MonthlyPoint[] {
  const buckets = new Map<MonthKey, MonthlyPoint>();
  for (const month of eachMonth(endMonth, months)) {
    buckets.set(month, { month, incomeMinor: 0, expenseMinor: 0, netMinor: 0 });
  }

  const keyOf = dayKeyer(timeZone);
  for (const transaction of db.transactions) {
    const bucket = buckets.get(keyOf(transaction.occurredAt).slice(0, 7));
    if (!bucket) continue;
    if (transaction.type === 'income') bucket.incomeMinor += transaction.amountMinor;
    else if (transaction.type === 'expense') bucket.expenseMinor += transaction.amountMinor;
    bucket.netMinor += signedAmount(transaction.type, transaction.amountMinor);
  }

  return [...buckets.values()];
}

/**
 * Net-worth timeline.
 *
 * Starts from the sum of opening balances plus everything that happened before
 * the window, then adds each day's net movement cumulatively. Transfers net to
 * zero automatically, since both legs fall on the same day.
 */
export function balanceTimeline(
  db: Database,
  range: DateRange,
  timeZone = LOCAL_TIMEZONE,
): BalancePoint[] {
  const opening = db.accounts.reduce((sum, account) => sum + account.openingBalanceMinor, 0);
  const keyOf = dayKeyer(timeZone);

  let priorMovement = 0;
  const movementByDay = new Map<DateKey, MinorUnits>();
  for (const transaction of db.transactions) {
    const day = keyOf(transaction.occurredAt);
    const delta = signedAmount(transaction.type, transaction.amountMinor);
    if (day < range.from) priorMovement += delta;
    else if (day <= range.to) movementByDay.set(day, (movementByDay.get(day) ?? 0) + delta);
  }

  let running = opening + priorMovement;
  return eachDay(range.from, range.to).map((date) => {
    running += movementByDay.get(date) ?? 0;
    return { date, balanceMinor: running };
  });
}

// ── Reports ─────────────────────────────────────────────────────────────────

export interface MonthlyReport {
  month: MonthKey;
  range: DateRange;
  totals: PeriodTotals;
  previous: { month: MonthKey; totals: PeriodTotals };
  changes: { incomeMinor: MinorUnits; expenseMinor: MinorUnits; netMinor: MinorUnits };
  averageDailySpendMinor: MinorUnits;
  largestExpense:
    | { id: string; description: string; amountMinor: MinorUnits; occurredAt: string; category: string | null }
    | null;
  topCategory: CategorySlice | null;
  categories: CategorySlice[];
  incomeCategories: CategorySlice[];
  daily: DailyPoint[];
  savingsRateBps: number;
}

export function monthlyReport(
  db: Database,
  month: MonthKey,
  timeZone = LOCAL_TIMEZONE,
): MonthlyReport {
  const range = monthBounds(month);
  const previousMonth = shiftMonth(month, -1);
  const totals = periodTotals(db, range, timeZone);
  const previousTotals = periodTotals(db, monthBounds(previousMonth), timeZone);
  const categories = categoryBreakdown(db, range, 'expense', timeZone);

  const expenses = inRange(db.transactions, range, timeZone)
    .filter((t) => t.type === 'expense')
    // Description breaks the tie, so "the largest expense" is the same
    // transaction on every render rather than whichever was stored first.
    .sort((a, b) => b.amountMinor - a.amountMinor || a.description.localeCompare(b.description));
  const biggest = expenses[0];
  const categoryName = biggest?.categoryId
    ? (db.categories.find((c) => c.id === biggest.categoryId)?.name ?? null)
    : null;

  // Average over elapsed days only, so the current month is not deflated by
  // days that have not happened yet.
  const today = todayKey(timeZone);
  const lastDay = today < range.to ? today : range.to;
  const elapsedDays = Math.max(
    1,
    Math.round((Date.parse(`${lastDay}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000) + 1,
  );

  return {
    month,
    range,
    totals,
    previous: { month: previousMonth, totals: previousTotals },
    changes: {
      incomeMinor: totals.incomeMinor - previousTotals.incomeMinor,
      expenseMinor: totals.expenseMinor - previousTotals.expenseMinor,
      netMinor: totals.netMinor - previousTotals.netMinor,
    },
    averageDailySpendMinor: Math.round(totals.expenseMinor / elapsedDays),
    largestExpense: biggest
      ? {
          id: biggest.id,
          description: biggest.description,
          amountMinor: biggest.amountMinor,
          occurredAt: biggest.occurredAt,
          category: categoryName,
        }
      : null,
    topCategory: categories[0] ?? null,
    categories,
    incomeCategories: categoryBreakdown(db, range, 'income', timeZone),
    daily: dailySeries(db, range, timeZone),
    savingsRateBps: ratioBps(totals.netMinor, totals.incomeMinor),
  };
}

export interface AccountReportRow {
  accountId: string;
  name: string;
  icon: string;
  color: string;
  type: string;
  balanceMinor: MinorUnits;
  inflowMinor: MinorUnits;
  outflowMinor: MinorUnits;
  transactionCount: number;
}

export function accountReport(
  db: Database,
  range: DateRange,
  balances: Map<string, MinorUnits>,
  timeZone = LOCAL_TIMEZONE,
): { range: DateRange; accounts: AccountReportRow[] } {
  const flows = new Map<string, { inflow: MinorUnits; outflow: MinorUnits; count: number }>();
  const bump = (id: string, delta: MinorUnits) => {
    const current = flows.get(id) ?? { inflow: 0, outflow: 0, count: 0 };
    if (delta >= 0) current.inflow += delta;
    else current.outflow += -delta;
    current.count += 1;
    flows.set(id, current);
  };

  for (const transaction of inRange(db.transactions, range, timeZone)) {
    switch (transaction.type) {
      case 'income':
      case 'adjustment':
        bump(transaction.accountId, transaction.amountMinor);
        break;
      case 'expense':
        bump(transaction.accountId, -transaction.amountMinor);
        break;
      case 'transfer':
        bump(transaction.accountId, -transaction.amountMinor);
        if (transaction.toAccountId) bump(transaction.toAccountId, transaction.amountMinor);
        break;
    }
  }

  return {
    range,
    accounts: db.accounts
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((account) => {
        const flow = flows.get(account.id) ?? { inflow: 0, outflow: 0, count: 0 };
        return {
          accountId: account.id,
          name: account.name,
          icon: account.icon,
          color: account.color,
          type: account.type,
          balanceMinor: balances.get(account.id) ?? account.openingBalanceMinor,
          inflowMinor: flow.inflow,
          outflowMinor: flow.outflow,
          transactionCount: flow.count,
        };
      }),
  };
}

export interface SavingsReport {
  months: MonthlyPoint[];
  totalIncomeMinor: MinorUnits;
  totalExpenseMinor: MinorUnits;
  totalNetMinor: MinorUnits;
  averageMonthlyNetMinor: MinorUnits;
  savingsRateBps: number;
  bestMonth: MonthlyPoint | null;
}

export function savingsReport(
  db: Database,
  endMonth: MonthKey,
  months = 12,
  timeZone = LOCAL_TIMEZONE,
): SavingsReport {
  const series = monthlySeries(db, endMonth, months, timeZone);
  const totalIncome = series.reduce((sum, m) => sum + m.incomeMinor, 0);
  const totalExpense = series.reduce((sum, m) => sum + m.expenseMinor, 0);
  const totalNet = series.reduce((sum, m) => sum + m.netMinor, 0);
  return {
    months: series,
    totalIncomeMinor: totalIncome,
    totalExpenseMinor: totalExpense,
    totalNetMinor: totalNet,
    averageMonthlyNetMinor: series.length ? Math.round(totalNet / series.length) : 0,
    savingsRateBps: ratioBps(totalNet, totalIncome),
    bestMonth: [...series].sort((a, b) => b.netMinor - a.netMinor)[0] ?? null,
  };
}

export interface YearlyReport {
  year: number;
  range: DateRange;
  totals: PeriodTotals;
  months: MonthlyPoint[];
  categories: CategorySlice[];
  savingsRateBps: number;
  averageMonthlyExpenseMinor: MinorUnits;
}

export function yearlyReport(
  db: Database,
  year: number,
  timeZone = LOCAL_TIMEZONE,
): YearlyReport {
  const range = { from: `${year}-01-01`, to: `${year}-12-31` };
  const totals = periodTotals(db, range, timeZone);
  return {
    year,
    range,
    totals,
    months: monthlySeries(db, `${year}-12`, 12, timeZone),
    categories: categoryBreakdown(db, range, 'expense', timeZone),
    savingsRateBps: ratioBps(totals.netMinor, totals.incomeMinor),
    averageMonthlyExpenseMinor: Math.round(totals.expenseMinor / 12),
  };
}

export interface CalendarMonth {
  month: MonthKey;
  range: DateRange;
  days: DailyPoint[];
  upcoming: { id: string; description: string; amountMinor: MinorUnits; dueOn: DateKey; type: string }[];
}

export function calendarMonth(
  db: Database,
  month: MonthKey,
  timeZone = LOCAL_TIMEZONE,
): CalendarMonth {
  const range = monthBounds(month);
  return {
    month,
    range,
    days: dailySeries(db, range, timeZone),
    upcoming: db.recurring
      .filter((rule) => rule.isActive && rule.nextRunOn && rule.nextRunOn >= range.from && rule.nextRunOn <= range.to)
      .map((rule) => ({
        id: rule.id,
        description: rule.description,
        amountMinor: rule.amountMinor,
        dueOn: rule.nextRunOn as DateKey,
        type: rule.type,
      }))
      .sort((a, b) => a.dueOn.localeCompare(b.dueOn)),
  };
}

export { toDateKey };
