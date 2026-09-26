/**
 * The dashboard, assembled from the ledger.
 *
 * This is the one screen that touches every part of the data model, so it gets
 * its own builder rather than a dozen hooks racing each other. Everything here
 * is derived in a single pass over one immutable database, which is why the
 * headline balance, the account cards and the charts can never disagree.
 */
import type {
  AccountView, BalancePoint, BudgetStatus, CategorySlice, DailyPoint, Database,
  MinorUnits, MonthlyPoint, PeriodTotals, TransactionView,
} from '../core/types';
import { LOCAL_TIMEZONE, addDays, currentMonthKey, monthBounds, shiftMonth, todayKey } from '../core/dates';
import { accountViews, netWorth, transactionViews, byDateDescending } from '../core/ledger';
import {
  balanceTimeline, categoryBreakdown, dailySeries, lifetimeTotals, monthlySeries, periodTotals,
} from '../core/analytics';
import { ratioBps } from '../core/money';
import { budgetViews } from '../core/budgets';
import { goalViews } from '../core/goals';
import { debtTotals } from '../core/debts';
import { dueRules, recurringViews } from '../core/recurring';
import { unreadCount } from '../core/notifications';

export interface DashboardData {
  generatedAt: string;
  timezone: string;
  currency: string;
  currentBalanceMinor: MinorUnits;
  lifetime: { receivedMinor: MinorUnits; spentMinor: MinorUnits; savedMinor: MinorUnits };
  summary: {
    totalMinor: MinorUnits;
    cashMinor: MinorUnits;
    bankMinor: MinorUnits;
    walletMinor: MinorUnits;
    creditCardMinor: MinorUnits;
    investmentMinor: MinorUnits;
  };
  thisMonth: {
    month: string;
    totals: PeriodTotals;
    savingsRateBps: number;
    averageDailySpendMinor: MinorUnits;
    changeVsLastMonth: { incomeMinor: MinorUnits; expenseMinor: MinorUnits; netMinor: MinorUnits };
  };
  accounts: AccountView[];
  recentTransactions: TransactionView[];
  categoryBreakdown: CategorySlice[];
  dailySpending: DailyPoint[];
  monthlyTrend: MonthlyPoint[];
  balanceTimeline: BalancePoint[];
  goals: {
    id: string; name: string; color: string; icon: string;
    targetMinor: MinorUnits; savedMinor: MinorUnits; progressBps: number; targetDate: string | null;
  }[];
  budgets: {
    id: string; name: string; color: string; limitMinor: MinorUnits;
    spentMinor: MinorUnits; usedBps: number; status: BudgetStatus;
  }[];
  debts: { iOweMinor: MinorUnits; owedToMeMinor: MinorUnits };
  upcoming: { id: string; description: string; amountMinor: MinorUnits; dueOn: string; type: string }[];
  unreadNotifications: number;
  /** True before the user has recorded anything — the page shows a welcome instead. */
  isEmpty: boolean;
  hasSampleData: boolean;
}

/** Account balances grouped by type, for the summary strip. */
function summarise(accounts: AccountView[]): DashboardData['summary'] {
  const byType = new Map<string, MinorUnits>();
  let totalMinor = 0;
  for (const account of accounts) {
    byType.set(account.type, (byType.get(account.type) ?? 0) + account.balanceMinor);
    totalMinor += account.balanceMinor;
  }
  return {
    totalMinor,
    cashMinor: byType.get('cash') ?? 0,
    // Savings sit with the bank: to a user they are both "money in the bank".
    bankMinor: (byType.get('bank') ?? 0) + (byType.get('savings') ?? 0),
    walletMinor: byType.get('wallet') ?? 0,
    creditCardMinor: byType.get('credit_card') ?? 0,
    investmentMinor: byType.get('investment') ?? 0,
  };
}

export function buildDashboard(db: Database, timelineDays = 30): DashboardData {
  const timeZone = LOCAL_TIMEZONE;
  const today = todayKey(timeZone);
  const month = currentMonthKey(timeZone);
  const range = monthBounds(month);
  const previousRange = monthBounds(shiftMonth(month, -1));

  const totals = periodTotals(db, range, timeZone);
  const previousTotals = periodTotals(db, previousRange, timeZone);
  const accounts = accountViews(db);

  // Only days that have happened count towards the daily average — dividing a
  // half-finished month by 31 would always understate it.
  const daysElapsed = Math.max(1, Number(today.slice(8, 10)));

  const recent = db.transactions.slice().sort(byDateDescending).slice(0, 8);

  return {
    generatedAt: new Date().toISOString(),
    timezone: timeZone,
    currency: db.profile.currency,
    currentBalanceMinor: netWorth(db),
    lifetime: lifetimeTotals(db),
    summary: summarise(accounts),
    thisMonth: {
      month,
      totals,
      savingsRateBps: ratioBps(totals.netMinor, totals.incomeMinor),
      averageDailySpendMinor: Math.round(totals.expenseMinor / daysElapsed),
      changeVsLastMonth: {
        incomeMinor: totals.incomeMinor - previousTotals.incomeMinor,
        expenseMinor: totals.expenseMinor - previousTotals.expenseMinor,
        netMinor: totals.netMinor - previousTotals.netMinor,
      },
    },
    accounts,
    recentTransactions: transactionViews(db, recent),
    categoryBreakdown: categoryBreakdown(db, range, 'expense', timeZone),
    dailySpending: dailySeries(db, range, timeZone),
    monthlyTrend: monthlySeries(db, month, 6, timeZone),
    balanceTimeline: balanceTimeline(
      db,
      { from: addDays(today, -(timelineDays - 1)), to: today },
      timeZone,
    ),
    goals: goalViews(db, { today, timeZone })
      .filter((goal) => goal.status === 'active')
      .slice(0, 4)
      .map((goal) => ({
        id: goal.id,
        name: goal.name,
        color: goal.color,
        icon: goal.icon,
        targetMinor: goal.targetMinor,
        savedMinor: goal.savedMinor,
        progressBps: goal.progressBps,
        targetDate: goal.targetDate,
      })),
    budgets: budgetViews(db, { activeOnly: true, today, timeZone })
      // Worst first: a budget in trouble is what the user needs to see.
      .sort((a, b) => b.usedBps - a.usedBps)
      .slice(0, 4)
      .map((budget) => ({
        id: budget.id,
        name: budget.name,
        color: budget.color,
        limitMinor: budget.limitMinor,
        spentMinor: budget.spentMinor,
        usedBps: budget.usedBps,
        status: budget.status,
      })),
    debts: (() => {
      const debt = debtTotals(db, { today, timeZone });
      return { iOweMinor: debt.iOweMinor, owedToMeMinor: debt.owedToMeMinor };
    })(),
    upcoming: upcomingPayments(db, today),
    unreadNotifications: unreadCount(db),
    isEmpty: db.transactions.length === 0,
    hasSampleData: db.transactions.some((t) => t.isSample),
  };
}

/** The next few things the user owes money on: schedules first, then debts. */
function upcomingPayments(db: Database, today: string): DashboardData['upcoming'] {
  const fromRules = recurringViews(db, { today, activeOnly: true })
    .filter((rule) => rule.nextRunOn)
    .map((rule) => ({
      id: rule.id,
      description: rule.description,
      amountMinor: rule.amountMinor,
      dueOn: rule.nextRunOn as string,
      type: rule.isSubscription ? 'subscription' : 'recurring',
    }));

  return fromRules.sort((a, b) => a.dueOn.localeCompare(b.dueOn)).slice(0, 5);
}

export { dueRules };
