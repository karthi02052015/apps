/**
 * Dates, recurring schedules, budgets, goals and debts.
 *
 * The recurring tests carry the most weight: posting is the only part of the
 * app that writes without a person asking it to, so "it cannot post twice" and
 * "it cannot drift off the 31st" are properties worth pinning down.
 */
import { describe, expect, it } from 'vitest';
import type { Database } from '../src/core/types';
import { addMonths, eachMonth, monthBounds, shiftMonth, weekBounds } from '../src/core/dates';
import {
  addGoalContribution, addRepayment, createBudget, createDebt, createGoal, createRecurring,
  createTransaction,
} from '../src/core/operations';
import { dueOccurrences, nextOccurrenceAfter, postDueOccurrences, recurringViews } from '../src/core/recurring';
import { budgetViews } from '../src/core/budgets';
import { goalViews } from '../src/core/goals';
import { debtTotals, debtViews } from '../src/core/debts';
import { netWorth } from '../src/core/ledger';
import { AT, accountByType, categoryByName, freshDb } from './helpers';

describe('calendar arithmetic', () => {
  it('clamps to the end of a short month instead of overflowing', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29'); // leap year
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30');
  });

  it('bounds a month and a Monday-based week', () => {
    expect(monthBounds('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    // 2026-09-24 is a Thursday.
    expect(weekBounds('2026-09-24')).toEqual({ from: '2026-09-21', to: '2026-09-27' });
  });

  it('walks months backwards across a year boundary', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(eachMonth('2026-02', 3)).toEqual(['2025-12', '2026-01', '2026-02']);
  });
});

describe('recurring occurrences', () => {
  const rule = { startDate: '2026-01-31', endDate: null, frequency: 'monthly' as const, intervalCount: 1 };

  it('does not drift after a short month', () => {
    // Generated from the start date, so February's clamp is not permanent.
    expect(nextOccurrenceAfter(rule, '2026-01-31')).toBe('2026-02-28');
    expect(nextOccurrenceAfter(rule, '2026-02-28')).toBe('2026-03-31');
    expect(nextOccurrenceAfter(rule, '2026-03-31')).toBe('2026-04-30');
    expect(nextOccurrenceAfter(rule, '2026-04-30')).toBe('2026-05-31');
  });

  it('stops at the end date', () => {
    const bounded = { ...rule, endDate: '2026-03-01' };
    expect(nextOccurrenceAfter(bounded, '2026-02-28')).toBeNull();
  });

  it('handles an interval greater than one', () => {
    const fortnightly = { startDate: '2026-01-01', endDate: null, frequency: 'weekly' as const, intervalCount: 2 };
    expect(nextOccurrenceAfter(fortnightly, '2026-01-01')).toBe('2026-01-15');
    expect(nextOccurrenceAfter(fortnightly, '2026-01-20')).toBe('2026-01-29');
  });

  it('catches up a schedule dormant for years without hanging', () => {
    const daily = { startDate: '2020-01-01', endDate: null, frequency: 'daily' as const, intervalCount: 1 };
    expect(nextOccurrenceAfter(daily, '2026-09-23')).toBe('2026-09-24');
  });
});

describe('posting', () => {
  function withRule(): { db: Database; ruleId: string } {
    const base = freshDb();
    const created = createRecurring(base, {
      type: 'expense',
      amountMinor: 99_900,
      accountId: accountByType(base, 'bank'),
      categoryId: categoryByName(base, 'Internet'),
      description: 'Broadband',
      frequency: 'monthly',
      startDate: '2026-01-12',
      autoPost: true,
    });
    return { db: created.db, ruleId: created.recurring.id };
  }

  it('posts every occurrence due up to a date', () => {
    const { db } = withRule();
    const result = postDueOccurrences(db, { upTo: '2026-03-31' });
    expect(result.posted).toBe(3); // January, February, March
    expect(result.db.transactions.map((t) => t.occurredAt.slice(0, 10))).toEqual([
      '2026-01-12', '2026-02-12', '2026-03-12',
    ]);
  });

  it('is idempotent — running it again posts nothing', () => {
    const { db } = withRule();
    const once = postDueOccurrences(db, { upTo: '2026-03-31' });
    const twice = postDueOccurrences(once.db, { upTo: '2026-03-31' });
    expect(twice.posted).toBe(0);
    expect(twice.db.transactions).toHaveLength(3);
  });

  it('leaves manual schedules alone', () => {
    const base = freshDb();
    const created = createRecurring(base, {
      type: 'expense',
      amountMinor: 50_000,
      accountId: accountByType(base, 'bank'),
      categoryId: categoryByName(base, 'Subscriptions'),
      description: 'Gym',
      frequency: 'monthly',
      startDate: '2026-01-05',
      autoPost: false,
    });
    expect(postDueOccurrences(created.db, { upTo: '2026-06-01' }).posted).toBe(0);
    // But it is still reported as due, so the user can post it themselves.
    // 5 January and 5 February; 5 March is past the cut-off.
    expect(dueOccurrences(created.db, created.recurring, '2026-03-01')).toEqual([
      '2026-01-05', '2026-02-05',
    ]);
  });

  it('reports a monthly-equivalent cost for every frequency', () => {
    const base = freshDb();
    const weekly = createRecurring(base, {
      type: 'expense',
      amountMinor: 10_000,
      accountId: accountByType(base, 'bank'),
      categoryId: categoryByName(base, 'Food'),
      description: 'Weekly delivery',
      frequency: 'weekly',
      startDate: '2026-01-01',
      isSubscription: true,
    });
    const view = recurringViews(weekly.db, { today: '2026-01-01' })[0];
    expect(view?.yearlyEquivalentMinor).toBe(521_775); // 52.1775 × ₹100
    expect(view?.monthlyEquivalentMinor).toBe(43_481);
  });
});

describe('budgets', () => {
  it('derives spend, status and a safe daily allowance', () => {
    const base = freshDb();
    const bankId = accountByType(base, 'bank');
    const food = categoryByName(base, 'Food');

    const withBudget = createBudget(base, {
      name: 'Eating out',
      period: 'monthly',
      limitMinor: 500_000,
      categoryIds: [food],
      alertThresholdPct: 80,
    }).db;

    const spent = createTransaction(withBudget, {
      type: 'expense',
      amountMinor: 420_000,
      accountId: bankId,
      categoryId: food,
      description: 'Restaurants',
      occurredAt: AT('2026-06-10'),
    }).db;

    const [view] = budgetViews(spent, { today: '2026-06-10', timeZone: 'UTC' });
    expect(view?.spentMinor).toBe(420_000);
    expect(view?.usedBps).toBe(8400);
    expect(view?.status).toBe('warning');
    // ₹800 left over 21 remaining days, floored so it cannot breach the limit.
    expect(view?.daysRemaining).toBe(21);
    expect(view?.safeDailyMinor).toBe(Math.floor(80_000 / 21));
  });

  it('ignores transfers, which are not spending', () => {
    const base = freshDb();
    const bankId = accountByType(base, 'bank');
    const cashId = accountByType(base, 'cash');
    const food = categoryByName(base, 'Food');
    const withBudget = createBudget(base, {
      name: 'Food', period: 'monthly', limitMinor: 100_000, categoryIds: [food],
    }).db;
    const moved = createTransaction(withBudget, {
      type: 'transfer',
      amountMinor: 90_000,
      accountId: bankId,
      toAccountId: cashId,
      description: 'Cash for the week',
      occurredAt: AT('2026-06-10'),
    }).db;
    expect(budgetViews(moved, { today: '2026-06-10', timeZone: 'UTC' })[0]?.spentMinor).toBe(0);
  });
});

describe('goals', () => {
  it('sums signed contributions and works out what is still needed', () => {
    const base = freshDb();
    const created = createGoal(base, {
      name: 'Laptop',
      targetMinor: 12_000_000,
      targetDate: '2026-12-31',
    });
    let db = addGoalContribution(created.db, created.goal.id, { amountMinor: 3_000_000, occurredOn: '2026-01-10' });
    db = addGoalContribution(db, created.goal.id, { amountMinor: 1_000_000, occurredOn: '2026-02-10' });
    // Taking money back out is a negative contribution, not a delete.
    db = addGoalContribution(db, created.goal.id, { amountMinor: -500_000, occurredOn: '2026-03-01' });

    const [view] = goalViews(db, { today: '2026-03-01' });
    expect(view?.savedMinor).toBe(3_500_000);
    expect(view?.remainingMinor).toBe(8_500_000);
    expect(view?.progressBps).toBe(2917);
    expect(view?.monthlyNeededMinor).toBeGreaterThan(0);
  });

  it('does not count a contribution as an expense', () => {
    const base = freshDb();
    const created = createGoal(base, { name: 'Trip', targetMinor: 100_000 });
    const before = netWorth(created.db);
    const after = addGoalContribution(created.db, created.goal.id, { amountMinor: 50_000 });
    expect(netWorth(after)).toBe(before);
  });
});

describe('debts', () => {
  it('derives status from what is outstanding', () => {
    const base = freshDb();
    const created = createDebt(base, {
      direction: 'i_owe',
      counterparty: 'Ravi',
      principalMinor: 200_000,
      dueDate: '2026-04-01',
    });

    let db = created.db;
    expect(debtViews(db, { today: '2026-03-01' })[0]?.status).toBe('pending');

    db = addRepayment(db, created.debt.id, { amountMinor: 50_000, paidOn: '2026-03-05' });
    expect(debtViews(db, { today: '2026-03-10' })[0]?.status).toBe('partially_paid');

    db = addRepayment(db, created.debt.id, { amountMinor: 150_000, paidOn: '2026-03-20' });
    const [settled] = debtViews(db, { today: '2026-03-25' });
    expect(settled?.status).toBe('paid');
    expect(settled?.outstandingMinor).toBe(0);
    expect(settled?.isOverdue).toBe(false);
  });

  it('refuses to be repaid more than is owed', () => {
    const base = freshDb();
    const created = createDebt(base, { direction: 'i_owe', counterparty: 'Ravi', principalMinor: 100_000 });
    expect(() => addRepayment(created.db, created.debt.id, { amountMinor: 100_001 })).toThrow();
  });

  it('moves real money when a repayment posts a transaction', () => {
    const base = freshDb();
    const bankId = accountByType(base, 'bank');
    const created = createDebt(base, { direction: 'i_owe', counterparty: 'Ravi', principalMinor: 100_000 });
    const before = netWorth(created.db);
    const paid = addRepayment(created.db, created.debt.id, {
      amountMinor: 40_000,
      accountId: bankId,
      categoryId: categoryByName(base, 'Other'),
    });
    expect(netWorth(paid)).toBe(before - 40_000);
    expect(paid.transactions).toHaveLength(1);
  });

  it('counts only live debts in the totals', () => {
    const base = freshDb();
    const owed = createDebt(base, { direction: 'owed_to_me', counterparty: 'Anu', principalMinor: 75_000 });
    const totals = debtTotals(owed.db, { today: '2026-03-01' });
    expect(totals.owedToMeMinor).toBe(75_000);
    expect(totals.iOweMinor).toBe(0);
    expect(totals.netMinor).toBe(75_000);
  });
});
