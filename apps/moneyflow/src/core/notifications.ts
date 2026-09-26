/**
 * The alert engine.
 *
 * Every alert carries a `dedupeKey`, so the same alert cannot be raised twice
 * for the same period — a budget that stays over its limit for three weeks
 * produces one notification, not twenty-one. `raiseNotification` in
 * `operations.ts` enforces that; the rules here only decide *what* to raise.
 *
 * There are two entry points, matching the two moments an alert can become
 * true:
 *
 *   • `evaluateAfterWrite` — triggered by recording a transaction (a large
 *     expense, a budget crossing its threshold).
 *   • `runScheduledChecks` — a sweep on app open and on date change (payments
 *     falling due, debts approaching, goals crossing a milestone).
 *
 * Both are pure: database in, database out.
 */
import type { AppNotification, Database, DateKey, MinorUnits, Transaction } from './types';
import { LOCAL_TIMEZONE, addDays, todayKey } from './dates';
import { formatMoney } from '../lib/format';
import { budgetViews } from './budgets';
import { goalViews } from './goals';
import { debtViews } from './debts';
import { recurringViews } from './recurring';
import { raiseNotification, updateGoal } from './operations';

type Prefs = Record<string, boolean>;

/** Unset means on: a new user gets every alert until they turn one off. */
function enabled(prefs: Prefs, key: string): boolean {
  return prefs[key] !== false;
}

function money(db: Database, amount: MinorUnits): string {
  return formatMoney(amount, db.profile.currency);
}

// ── Write-time rules ────────────────────────────────────────────────────────

/**
 * Runs after a transaction is recorded.
 *
 * Only expenses can trigger an alert, and sample data never does — a preview
 * of what the app looks like should not fill the bell with warnings.
 */
export function evaluateAfterWrite(db: Database, transaction: Transaction): Database {
  if (transaction.type !== 'expense' || transaction.isSample) return db;

  const prefs = db.profile.notificationPrefs;
  const threshold = db.profile.largeExpenseThresholdMinor;
  let next = db;

  if (enabled(prefs, 'largeExpenses') && threshold > 0 && transaction.amountMinor >= threshold) {
    next = raiseNotification(next, {
      type: 'large_expense',
      severity: 'info',
      title: 'Large expense recorded',
      body: `${money(next, transaction.amountMinor)} for ${transaction.description}.`,
      payload: { transactionId: transaction.id },
      dedupeKey: `large_expense:${transaction.id}`,
    });
  }

  if (!enabled(prefs, 'budgetAlerts') || !transaction.categoryId) return next;

  for (const budget of budgetViews(next, { activeOnly: true })) {
    if (budget.status === 'on_track') continue;
    if (!budget.categoryIds.includes(transaction.categoryId)) continue;

    // The window start is part of the key, so next month's breach alerts again.
    const period = budget.periodStart;
    next =
      budget.status === 'exceeded'
        ? raiseNotification(next, {
            type: 'budget_exceeded',
            severity: 'critical',
            title: `${budget.name} budget exceeded`,
            body:
              `You have spent ${money(next, budget.spentMinor)} of your ` +
              `${money(next, budget.limitMinor)} ${budget.period} limit.`,
            payload: { budgetId: budget.id, usedBps: budget.usedBps },
            dedupeKey: `budget_exceeded:${budget.id}:${period}`,
          })
        : raiseNotification(next, {
            type: 'budget_warning',
            severity: 'warning',
            title: `${budget.name} budget is running low`,
            body:
              `You have used ${Math.round(budget.usedBps / 100)}% of your ${budget.name} budget — ` +
              `${money(next, budget.remainingMinor)} left.`,
            payload: { budgetId: budget.id, usedBps: budget.usedBps },
            dedupeKey: `budget_warning:${budget.id}:${period}`,
          });
  }

  return next;
}

// ── Scheduled sweep ─────────────────────────────────────────────────────────

/** Milestones are checked highest-first, so 100% wins over 75%. */
const GOAL_MILESTONES_BPS = [10_000, 7_500, 5_000, 2_500] as const;

/**
 * The periodic sweep: upcoming recurring payments, debts falling due, and
 * savings goals crossing a milestone.
 *
 * Reaching 100% also flips the goal to `achieved`, which is the one write this
 * function makes beyond the notifications themselves.
 */
export function runScheduledChecks(
  db: Database,
  options: { today?: DateKey; timeZone?: string } = {},
): Database {
  const timeZone = options.timeZone ?? LOCAL_TIMEZONE;
  const today = options.today ?? todayKey(timeZone);
  const prefs = db.profile.notificationPrefs;
  let next = db;

  if (enabled(prefs, 'recurringReminders')) {
    const horizon = addDays(today, 2);
    for (const rule of recurringViews(next, { today, activeOnly: true })) {
      if (!rule.nextRunOn || rule.nextRunOn < today || rule.nextRunOn > horizon) continue;
      const when = rule.nextRunOn === today ? 'today' : 'soon';
      next = raiseNotification(next, {
        type: 'recurring_due',
        severity: 'info',
        title: 'Upcoming payment',
        body: `Your ${rule.description} of ${money(next, rule.amountMinor)} is due ${when}.`,
        payload: { recurringId: rule.id, dueOn: rule.nextRunOn },
        dedupeKey: `recurring_due:${rule.id}:${rule.nextRunOn}`,
      });
    }
  }

  if (enabled(prefs, 'debtReminders')) {
    // A month back for things already missed, three days forward for warning.
    const from = addDays(today, -30);
    const to = addDays(today, 3);
    for (const debt of debtViews(next, { today, timeZone })) {
      if (debt.status !== 'pending' && debt.status !== 'partially_paid') continue;
      if (!debt.dueDate || debt.dueDate < from || debt.dueDate > to) continue;
      const overdue = debt.dueDate < today;
      next = raiseNotification(next, {
        type: 'debt_due',
        severity: overdue ? 'warning' : 'info',
        title: overdue ? 'Overdue repayment' : 'Repayment due soon',
        body:
          debt.direction === 'i_owe'
            ? `${money(next, debt.outstandingMinor)} to ${debt.counterparty} ${overdue ? 'was' : 'is'} due ${debt.dueDate}.`
            : `${debt.counterparty} owes you ${money(next, debt.outstandingMinor)} — due ${debt.dueDate}.`,
        payload: { debtId: debt.id, dueDate: debt.dueDate },
        dedupeKey: `debt_due:${debt.id}:${debt.dueDate}:${overdue ? 'over' : 'soon'}`,
      });
    }
  }

  if (enabled(prefs, 'goalMilestones')) {
    for (const goal of goalViews(next, { today, timeZone })) {
      if (goal.status !== 'active') continue;
      const milestone = GOAL_MILESTONES_BPS.find((m) => goal.progressBps >= m);
      if (!milestone) continue;
      const achieved = milestone === 10_000;
      next = raiseNotification(next, {
        type: achieved ? 'goal_achieved' : 'goal_milestone',
        severity: 'success',
        title: achieved ? `${goal.name} — goal reached` : `${goal.name} is ${milestone / 100}% funded`,
        body: achieved
          ? `You have saved the full ${money(next, goal.targetMinor)}.`
          : `You are ${milestone / 100}% of the way to ${money(next, goal.targetMinor)}.`,
        payload: { goalId: goal.id, milestoneBps: milestone },
        dedupeKey: `goal:${goal.id}:${milestone}`,
      });
      if (achieved) next = updateGoal(next, goal.id, { status: 'achieved' });
    }
  }

  return next;
}

// ── Reading ─────────────────────────────────────────────────────────────────

export function unreadCount(db: Database): number {
  return db.notifications.filter((n) => !n.readAt).length;
}

export function notificationList(
  db: Database,
  options: { unreadOnly?: boolean; limit?: number } = {},
): AppNotification[] {
  return db.notifications
    .filter((n) => !options.unreadOnly || !n.readAt)
    .slice(0, options.limit ?? 50);
}
