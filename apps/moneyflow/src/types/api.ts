/**
 * The names the UI knows things by.
 *
 * Components think in terms of "an Account" — the thing with a balance on it —
 * not "an `AccountView` derived from an `Account` record". This file maps the
 * core model's precise names onto the ones the components read naturally, in
 * one place, so no component has to import from `core/` and none of them had to
 * change when the server was removed.
 */
export type {
  AccountType, BudgetPeriod, BudgetStatus, CategoryKind, CategoryRef, DateKey, DateRange,
  DebtDirection, DebtStatus, Frequency, GoalStatus, MinorUnits, MonthKey, MoneyPurpose,
  PaymentMethod, Theme, Timestamp, TransactionType,
  BalancePoint, CategorySlice, DailyPoint, MonthlyPoint, PeriodTotals,
  Category, GoalContribution,
} from '../core/types';

export type {
  AccountView as Account,
  BudgetView as Budget,
  DebtView as Debt,
  DebtPayment,
  GoalView as Goal,
  RecurringView as Recurring,
  TransactionView as Transaction,
  AppNotification as Notification,
} from '../core/types';

export type { CurrentUser as User } from '../contexts/ProfileContext';
export type { Insight } from '../core/insights';
export type {
  AccountReportRow, CalendarMonth, MonthlyReport, SavingsReport, YearlyReport,
} from '../core/analytics';
export type { SubscriptionSummary } from '../core/recurring';
export type { DebtTotals } from '../core/debts';
export type { AccountTotals, TransactionFilters } from '../hooks/queries';
export type { DashboardData as Dashboard } from '../store/dashboard';
