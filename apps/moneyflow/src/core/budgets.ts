/**
 * Budgets.
 *
 * A budget is a spending limit over a repeating window — week, month or year —
 * applied to a set of expense categories. Nothing is precomputed: the amount
 * spent is derived from the transaction list every time it is asked for, so
 * editing or deleting a transaction updates every budget instantly and there
 * is no cache that can disagree with the ledger.
 *
 * The window is computed in the *user's* timezone, because "this month" has to
 * mean their month, not UTC's.
 */
import type {
  Budget, BudgetStatus, BudgetView, CategoryRef, Database, DateKey, MinorUnits,
} from './types';
import { ratioBps } from './money';
import {
  LOCAL_TIMEZONE, daysBetween, monthBounds, todayKey, toDateKey, weekBounds, yearBounds,
} from './dates';

/** The window a budget is currently inside, in the user's own calendar. */
export function budgetPeriodBounds(
  period: Budget['period'],
  today: DateKey,
): { from: DateKey; to: DateKey } {
  switch (period) {
    case 'weekly':
      return weekBounds(today);
    case 'yearly':
      return yearBounds(today);
    default:
      return monthBounds(today.slice(0, 7));
  }
}

/**
 * Spend against one budget inside one window.
 *
 * Only `expense` transactions count. Transfers move money between the user's
 * own accounts and would otherwise inflate every budget they touched.
 */
function spendFor(
  db: Database,
  categoryIds: readonly string[],
  from: DateKey,
  to: DateKey,
  timeZone: string,
): MinorUnits {
  if (categoryIds.length === 0) return 0;
  const wanted = new Set(categoryIds);
  let total = 0;
  for (const transaction of db.transactions) {
    if (transaction.type !== 'expense') continue;
    if (!transaction.categoryId || !wanted.has(transaction.categoryId)) continue;
    const day = toDateKey(transaction.occurredAt, timeZone);
    if (day < from || day > to) continue;
    total += transaction.amountMinor;
  }
  return total;
}

export function toBudgetView(
  db: Database,
  budget: Budget,
  options: { today?: DateKey; timeZone?: string } = {},
): BudgetView {
  const timeZone = options.timeZone ?? LOCAL_TIMEZONE;
  const today = options.today ?? todayKey(timeZone);
  const { from, to } = budgetPeriodBounds(budget.period, today);

  const spentMinor = spendFor(db, budget.categoryIds, from, to, timeZone);
  const remainingMinor = budget.limitMinor - spentMinor;
  const usedBps = ratioBps(spentMinor, budget.limitMinor);
  const thresholdBps = budget.alertThresholdPct * 100;

  const status: BudgetStatus =
    usedBps >= 10_000 ? 'exceeded' : usedBps >= thresholdBps ? 'warning' : 'on_track';

  // Inclusive of today: a budget whose window ends today still has one day left
  // to spend in.
  const daysRemaining = Math.max(0, daysBetween(today, to) + 1);

  const byId = new Map(db.categories.map((c) => [c.id, c]));
  const categories: CategoryRef[] = budget.categoryIds
    .map((id) => byId.get(id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .map((c) => ({ id: c.id, name: c.name, icon: c.icon, color: c.color }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    ...budget,
    spentMinor,
    remainingMinor,
    usedBps,
    status,
    periodStart: from,
    periodEnd: to,
    daysRemaining,
    // Floor, never round: a rounded-up daily allowance would breach the limit.
    safeDailyMinor:
      remainingMinor > 0 && daysRemaining > 0 ? Math.floor(remainingMinor / daysRemaining) : 0,
    categories,
  };
}

export function budgetViews(
  db: Database,
  options: { activeOnly?: boolean; today?: DateKey; timeZone?: string } = {},
): BudgetView[] {
  return db.budgets
    .filter((budget) => !options.activeOnly || budget.isActive)
    .map((budget) => toBudgetView(db, budget, options))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface BudgetSummary {
  totalLimitMinor: MinorUnits;
  totalSpentMinor: MinorUnits;
  usedBps: number;
  exceededCount: number;
  warningCount: number;
  budgets: BudgetView[];
}

export function budgetSummary(
  db: Database,
  options: { today?: DateKey; timeZone?: string } = {},
): BudgetSummary {
  const budgets = budgetViews(db, { ...options, activeOnly: true });
  const totalLimitMinor = budgets.reduce((sum, b) => sum + b.limitMinor, 0);
  const totalSpentMinor = budgets.reduce((sum, b) => sum + b.spentMinor, 0);
  return {
    totalLimitMinor,
    totalSpentMinor,
    usedBps: ratioBps(totalSpentMinor, totalLimitMinor),
    exceededCount: budgets.filter((b) => b.status === 'exceeded').length,
    warningCount: budgets.filter((b) => b.status === 'warning').length,
    budgets,
  };
}

/**
 * Which categories are already covered by a budget.
 *
 * The form uses it to warn that two budgets counting the same category will
 * both be charged for the same spending.
 */
export function budgetedCategoryIds(db: Database, excludeBudgetId?: string): Set<string> {
  const ids = new Set<string>();
  for (const budget of db.budgets) {
    if (!budget.isActive || budget.id === excludeBudgetId) continue;
    for (const id of budget.categoryIds) ids.add(id);
  }
  return ids;
}
