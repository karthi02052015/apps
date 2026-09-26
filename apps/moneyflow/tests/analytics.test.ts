/**
 * Analytics, alerts and insights.
 *
 * The recurring theme: transfers are money moving, not money earned or spent,
 * and every aggregate has to know that. The alert tests pin down the dedupe
 * behaviour, which is what stops the bell filling with the same warning every
 * time the app opens.
 */
import { describe, expect, it } from 'vitest';
import type { Database } from '../src/core/types';
import {
  balanceTimeline, categoryBreakdown, dailySeries, monthlyReport, monthlySeries, periodTotals,
} from '../src/core/analytics';
import { createBudget, createGoal, addGoalContribution, createTransaction, updateProfile } from '../src/core/operations';
import { evaluateAfterWrite, runScheduledChecks, unreadCount } from '../src/core/notifications';
import { insightsFor } from '../src/core/insights';
import { buildDashboard } from '../src/store/dashboard';
import { queryTransactions } from '../src/store/transactions';
import { AT, accountByType, categoryByName, freshDb } from './helpers';

const UTC = 'UTC';
const MARCH = { from: '2026-03-01', to: '2026-03-31' };

function scenario(): Database {
  const base = freshDb();
  const bankId = accountByType(base, 'bank');
  const cashId = accountByType(base, 'cash');
  let db: Database = {
    ...base,
    accounts: base.accounts.map((a) => (a.id === bankId ? { ...a, openingBalanceMinor: 1_000_000 } : a)),
  };

  const add = (
    type: 'income' | 'expense',
    categoryName: string,
    amountMinor: number,
    day: string,
  ) => {
    db = createTransaction(db, {
      type,
      amountMinor,
      accountId: bankId,
      categoryId: categoryByName(db, categoryName),
      description: `${categoryName} ${day}`,
      occurredAt: AT(day),
    }).db;
  };

  add('income', 'Salary', 5_000_000, '2026-03-01');
  add('expense', 'Rent', 1_500_000, '2026-03-03');
  add('expense', 'Food', 200_000, '2026-03-05');
  add('expense', 'Food', 100_000, '2026-03-06');
  add('expense', 'Groceries', 300_000, '2026-03-07');
  // February, so the month-over-month comparison has something to compare to.
  add('income', 'Salary', 5_000_000, '2026-02-01');
  add('expense', 'Food', 500_000, '2026-02-10');

  db = createTransaction(db, {
    type: 'transfer',
    amountMinor: 400_000,
    accountId: bankId,
    toAccountId: cashId,
    description: 'Cash withdrawal',
    occurredAt: AT('2026-03-08'),
  }).db;

  return db;
}

describe('period totals', () => {
  it('excludes transfers from income and expense', () => {
    const totals = periodTotals(scenario(), MARCH, UTC);
    expect(totals.incomeMinor).toBe(5_000_000);
    expect(totals.expenseMinor).toBe(2_100_000);
    expect(totals.transferMinor).toBe(400_000);
    expect(totals.netMinor).toBe(2_900_000);
  });

  it('counts an adjustment towards the net', () => {
    const base = freshDb();
    const adjusted = createTransaction(base, {
      type: 'adjustment',
      amountMinor: -25_000,
      accountId: accountByType(base, 'bank'),
      description: 'Bank fee correction',
      occurredAt: AT('2026-03-15'),
    }).db;
    const totals = periodTotals(adjusted, MARCH, UTC);
    expect(totals.adjustmentMinor).toBe(-25_000);
    expect(totals.netMinor).toBe(-25_000);
  });
});

describe('category breakdown', () => {
  it('shares add up to 100% and transfers are absent', () => {
    const slices = categoryBreakdown(scenario(), MARCH, 'expense', UTC);
    // Food and Groceries are both ₹3,000, so the order is settled by name.
    expect(slices.map((s) => s.name)).toEqual(['Rent', 'Food', 'Groceries']);
    expect(slices[0]?.shareBps).toBe(7143);
    expect(slices.reduce((sum, s) => sum + s.amountMinor, 0)).toBe(2_100_000);
    expect(slices.some((s) => s.name.includes('withdrawal'))).toBe(false);
  });
});

describe('series', () => {
  it('fills days with no activity', () => {
    const days = dailySeries(scenario(), MARCH, UTC);
    expect(days).toHaveLength(31);
    expect(days.find((d) => d.date === '2026-03-02')?.expenseMinor).toBe(0);
    expect(days.find((d) => d.date === '2026-03-03')?.expenseMinor).toBe(1_500_000);
  });

  it('fills months with no activity', () => {
    const months = monthlySeries(scenario(), '2026-03', 4, UTC);
    expect(months.map((m) => m.month)).toEqual(['2025-12', '2026-01', '2026-02', '2026-03']);
    expect(months[0]?.incomeMinor).toBe(0);
  });

  it('ends the balance timeline at the current net worth', () => {
    const db = scenario();
    const points = balanceTimeline(db, MARCH, UTC);
    // Opening ₹10,000 + February's ₹45,000 net + March's ₹29,000 net.
    expect(points.at(-1)?.balanceMinor).toBe(1_000_000 + 4_500_000 + 2_900_000);
  });
});

describe('monthly report', () => {
  it('compares against the previous month', () => {
    const report = monthlyReport(scenario(), '2026-03', UTC);
    expect(report.totals.expenseMinor).toBe(2_100_000);
    expect(report.previous.totals.expenseMinor).toBe(500_000);
    expect(report.changes.expenseMinor).toBe(1_600_000);
    expect(report.largestExpense?.amountMinor).toBe(1_500_000);
    expect(report.topCategory?.name).toBe('Rent');
  });
});

describe('transaction queries', () => {
  it('matches a transfer from either side of it', () => {
    const db = scenario();
    const cashId = accountByType(db, 'cash');
    const page = queryTransactions(db, { accountId: [cashId] });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.type).toBe('transfer');
  });

  it('searches descriptions and notes', () => {
    const page = queryTransactions(scenario(), { q: 'withdrawal' });
    expect(page.items).toHaveLength(1);
  });

  it('reports totals for everything matching, not just the page', () => {
    const page = queryTransactions(scenario(), { type: ['expense'], pageSize: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.meta.total).toBe(5); // four in March, one in February
    expect(page.meta.expenseMinor).toBe(2_600_000); // includes February
  });
});

describe('the dashboard', () => {
  it('agrees with the ledger it was built from', () => {
    const db = scenario();
    const dashboard = buildDashboard(db);
    expect(dashboard.currentBalanceMinor).toBe(
      dashboard.accounts.reduce((sum, a) => sum + a.balanceMinor, 0),
    );
    expect(dashboard.lifetime.receivedMinor).toBe(10_000_000);
    expect(dashboard.lifetime.spentMinor).toBe(2_600_000);
    expect(dashboard.isEmpty).toBe(false);
  });

  it('knows when there is nothing to show', () => {
    expect(buildDashboard(freshDb()).isEmpty).toBe(true);
  });
});

describe('alerts', () => {
  it('raises a budget warning once per period, not once per transaction', () => {
    const base = freshDb();
    const bankId = accountByType(base, 'bank');
    const food = categoryByName(base, 'Food');
    let db = createBudget(base, {
      name: 'Food', period: 'monthly', limitMinor: 100_000, categoryIds: [food], alertThresholdPct: 80,
    }).db;

    for (let i = 0; i < 5; i += 1) {
      const created = createTransaction(db, {
        type: 'expense',
        amountMinor: 30_000,
        accountId: bankId,
        categoryId: food,
        description: `Lunch ${i}`,
      });
      db = evaluateAfterWrite(created.db, created.transaction);
    }

    const budgetAlerts = db.notifications.filter((n) => n.type.startsWith('budget_'));
    // One warning when it crossed 80%, one when it went over. Not five of each.
    expect(budgetAlerts.filter((n) => n.type === 'budget_warning')).toHaveLength(1);
    expect(budgetAlerts.filter((n) => n.type === 'budget_exceeded')).toHaveLength(1);
  });

  it('flags a large expense, and respects the threshold', () => {
    const base = updateProfile(freshDb(), { largeExpenseThresholdMinor: 500_000 });
    const bankId = accountByType(base, 'bank');
    const big = createTransaction(base, {
      type: 'expense',
      amountMinor: 600_000,
      accountId: bankId,
      categoryId: categoryByName(base, 'Shopping'),
      description: 'New phone',
    });
    expect(evaluateAfterWrite(big.db, big.transaction).notifications[0]?.type).toBe('large_expense');

    const small = createTransaction(base, {
      type: 'expense',
      amountMinor: 400_000,
      accountId: bankId,
      categoryId: categoryByName(base, 'Shopping'),
      description: 'Headphones',
    });
    expect(evaluateAfterWrite(small.db, small.transaction).notifications).toHaveLength(0);
  });

  it('never alerts on sample data', () => {
    const base = updateProfile(freshDb(), { largeExpenseThresholdMinor: 100 });
    const created = createTransaction(base, {
      type: 'expense',
      amountMinor: 900_000,
      accountId: accountByType(base, 'bank'),
      categoryId: categoryByName(base, 'Shopping'),
      description: 'Demo purchase',
      isSample: true,
    });
    expect(evaluateAfterWrite(created.db, created.transaction).notifications).toHaveLength(0);
  });

  it('marks a goal achieved when it reaches its target', () => {
    const base = freshDb();
    const created = createGoal(base, { name: 'Camera', targetMinor: 100_000 });
    const funded = addGoalContribution(created.db, created.goal.id, { amountMinor: 100_000 });
    const checked = runScheduledChecks(funded, { today: '2026-03-01', timeZone: UTC });

    expect(checked.goals[0]?.status).toBe('achieved');
    expect(checked.notifications.some((n) => n.type === 'goal_achieved')).toBe(true);

    // Running the sweep again must not raise it a second time.
    const again = runScheduledChecks(checked, { today: '2026-03-02', timeZone: UTC });
    expect(again.notifications.filter((n) => n.type === 'goal_achieved')).toHaveLength(1);
  });

  it('stays quiet when the user has turned an alert off', () => {
    const base = updateProfile(freshDb(), {
      notificationPrefs: { largeExpenses: false },
      largeExpenseThresholdMinor: 100,
    });
    const created = createTransaction(base, {
      type: 'expense',
      amountMinor: 900_000,
      accountId: accountByType(base, 'bank'),
      categoryId: categoryByName(base, 'Shopping'),
      description: 'Laptop',
    });
    expect(unreadCount(evaluateAfterWrite(created.db, created.transaction))).toBe(0);
  });
});

describe('insights', () => {
  it('describes the month without recommending anything', () => {
    const insights = insightsFor(scenario(), { month: '2026-03', timeZone: UTC });
    expect(insights.length).toBeGreaterThan(0);

    const ids = insights.map((insight) => insight.id);
    expect(ids).toContain('net-savings');
    expect(ids.some((id) => id.startsWith('top-category:'))).toBe(true);

    // Every insight ships the figures it was derived from.
    for (const insight of insights) expect(Object.keys(insight.facts).length).toBeGreaterThan(0);
  });

  it('says nothing at all about an empty month', () => {
    expect(insightsFor(freshDb(), { month: '2026-03', timeZone: UTC })).toHaveLength(0);
  });
});
