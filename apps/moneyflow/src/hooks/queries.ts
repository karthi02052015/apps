/**
 * Every read and write the UI performs, in one place.
 *
 * These keep the shape of the data-fetching hooks they replaced —
 * `{ data, isLoading, refetch }` for reads, `{ mutate, mutateAsync, isPending }`
 * for writes — so the pages did not have to be rewritten when the server went
 * away. What changed is underneath: there is no cache, no network and no
 * invalidation. Every read is a pure function of one immutable database object,
 * so a write is visible in every view on the very next render, and two screens
 * cannot disagree.
 *
 * Amounts arrive from forms as the text the user typed and are parsed here with
 * `parseAmountToMinor`, which throws on anything ambiguous. No rounding
 * happens silently anywhere on this path.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type {
  AccountView, AppNotification, BudgetView, Category, DebtDirection, DebtStatus, DebtView,
  GoalView, MonthKey, RecurringView, TransactionType,
} from '../core/types';
import { AppError } from '../lib/errors';
import { parseAmountToMinor } from '../core/money';
import { LOCAL_TIMEZONE, currentMonthKey, todayKey } from '../core/dates';
import { accountBalances, accountViews } from '../core/ledger';
import {
  accountReport, calendarMonth, monthlyReport, savingsReport, yearlyReport,
} from '../core/analytics';
import { budgetViews } from '../core/budgets';
import { goalViews } from '../core/goals';
import { debtTotals, debtViews } from '../core/debts';
import { postOccurrence, recurringViews, subscriptionSummary } from '../core/recurring';
import { insightsFor } from '../core/insights';
import { notificationList, unreadCount, evaluateAfterWrite } from '../core/notifications';
import * as ops from '../core/operations';
import { withSampleData } from '../core/sample';
import { useLedger } from '../store/LedgerProvider';
import { buildDashboard } from '../store/dashboard';
import {
  frequentCategories, queryTransactions,
  type TransactionFilters, type TransactionsPage,
} from '../store/transactions';

export type { TransactionFilters, TransactionsPage };

// ── The read shim ───────────────────────────────────────────────────────────

export interface QueryResult<T> {
  data: T | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Wraps a derivation in the shape the pages expect.
 *
 * `isFetching` is always false and `refetch` is a no-op: there is nothing to
 * fetch. They exist so the pages' loading affordances compile and behave
 * sensibly rather than having to be stripped out.
 */
function useDerived<T>(compute: () => T, deps: unknown[]): QueryResult<T> {
  const { status } = useLedger();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(() => (status === 'ready' ? compute() : undefined), [status, ...deps]);
  return {
    data: value,
    isLoading: status !== 'ready',
    isFetching: false,
    isError: false,
    error: null,
    refetch: () => {},
  };
}

const tz = LOCAL_TIMEZONE;

// ─────────────────────────────────────────────────────────────────  reads ───

export function useDashboard(timelineDays = 30) {
  const { db } = useLedger();
  return useDerived(() => buildDashboard(db, timelineDays), [db, timelineDays]);
}

export interface AccountTotals {
  totalMinor: number;
  cashMinor: number;
  bankMinor: number;
  walletMinor: number;
  creditCardMinor: number;
  investmentMinor: number;
  byType: Record<string, number>;
}

export function useAccounts(includeArchived = false) {
  const { db } = useLedger();
  return useDerived(() => {
    const accounts = accountViews(db, { includeArchived });
    const byType: Record<string, number> = {};
    let totalMinor = 0;
    for (const account of accounts) {
      if (account.isArchived) continue;
      byType[account.type] = (byType[account.type] ?? 0) + account.balanceMinor;
      totalMinor += account.balanceMinor;
    }
    const totals: AccountTotals = {
      totalMinor,
      cashMinor: byType.cash ?? 0,
      bankMinor: (byType.bank ?? 0) + (byType.savings ?? 0),
      walletMinor: byType.wallet ?? 0,
      creditCardMinor: byType.credit_card ?? 0,
      investmentMinor: byType.investment ?? 0,
      byType,
    };
    return { accounts, totals };
  }, [db, includeArchived]);
}

export function useAccount(id: string | undefined) {
  const { db } = useLedger();
  return useDerived(
    () => (id ? accountViews(db, { includeArchived: true }).find((a) => a.id === id) : undefined),
    [db, id],
  );
}

export interface CategoryWithUsage extends Category {
  /** How many transactions reference it — what decides whether it can be deleted. */
  usageCount: number;
}

export function useCategories(kind?: 'income' | 'expense', includeArchived = false) {
  const { db } = useLedger();
  return useDerived<CategoryWithUsage[]>(() => {
    const usage = ops.categoryUsage(db);
    return db.categories
      .filter((category) => (!kind || category.kind === kind) && (includeArchived || !category.isArchived))
      .map((category) => ({ ...category, usageCount: usage.get(category.id) ?? 0 }))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }, [db, kind, includeArchived]);
}

export function useFrequentCategories(kind: 'income' | 'expense') {
  const { db } = useLedger();
  return useDerived(() => {
    const ids = frequentCategories(db, kind);
    const byId = new Map(db.categories.map((c) => [c.id, c]));
    const frequent = ids
      .map((id) => byId.get(id))
      .filter((c): c is Category => Boolean(c) && !c!.isArchived);
    // A brand-new user has no history, so fall back to the first few of that
    // kind rather than showing an empty row of shortcuts.
    if (frequent.length > 0) return frequent;
    return db.categories.filter((c) => c.kind === kind && !c.isArchived).slice(0, 6);
  }, [db, kind]);
}

export function useTransactions(
  filters: TransactionFilters,
  options: { enabled?: boolean } = {},
) {
  const { db } = useLedger();
  const key = JSON.stringify(filters);
  const enabled = options.enabled ?? true;
  return useDerived(
    () => (enabled ? queryTransactions(db, filters) : undefined),
    [db, key, enabled],
  );
}

export function useTransaction(id: string | undefined) {
  const { db } = useLedger();
  return useDerived(
    () => (id ? queryTransactions(db, { pageSize: 200 }).items.find((t) => t.id === id) : undefined),
    [db, id],
  );
}

export function useBudgets() {
  const { db } = useLedger();
  return useDerived<BudgetView[]>(() => budgetViews(db, { timeZone: tz }), [db]);
}

export function useGoals(includeArchived = false) {
  const { db } = useLedger();
  return useDerived<GoalView[]>(() => goalViews(db, { includeArchived, timeZone: tz }), [db, includeArchived]);
}

export function useGoal(id: string | undefined) {
  const { db } = useLedger();
  return useDerived(
    () => (id ? goalViews(db, { includeArchived: true }).find((g) => g.id === id) : undefined),
    [db, id],
  );
}

export function useRecurring(subscriptionsOnly = false, includeInactive = false) {
  const { db } = useLedger();
  return useDerived<RecurringView[]>(
    () => recurringViews(db, { subscriptionsOnly, activeOnly: !includeInactive, timeZone: tz }),
    [db, subscriptionsOnly, includeInactive],
  );
}

export function useSubscriptions() {
  const { db } = useLedger();
  return useDerived(() => subscriptionSummary(db, { timeZone: tz }), [db]);
}

export function useDebts(direction?: string, status?: string) {
  const { db } = useLedger();
  return useDerived(() => {
    const debts: DebtView[] = debtViews(db, {
      ...(direction ? { direction: direction as DebtDirection } : {}),
      ...(status ? { status: status as DebtStatus } : {}),
      timeZone: tz,
    });
    return { debts, totals: debtTotals(db, { timeZone: tz }) };
  }, [db, direction, status]);
}

export function useDebt(id: string | undefined) {
  const { db } = useLedger();
  return useDerived(() => (id ? debtViews(db).find((d) => d.id === id) : undefined), [db, id]);
}

export function useNotifications(unreadOnly = false) {
  const { db } = useLedger();
  return useDerived(
    () => ({
      items: notificationList(db, { unreadOnly, limit: 50 }) as AppNotification[],
      unread: unreadCount(db),
    }),
    [db, unreadOnly],
  );
}

export function useInsights(month: MonthKey) {
  const { db } = useLedger();
  return useDerived(() => insightsFor(db, { month, timeZone: tz }), [db, month]);
}

export function useMonthlyReport(month: MonthKey) {
  const { db } = useLedger();
  return useDerived(() => monthlyReport(db, month, tz), [db, month]);
}

export function useAccountReport(from: string, to: string) {
  const { db } = useLedger();
  return useDerived(() => accountReport(db, { from, to }, accountBalances(db), tz), [db, from, to]);
}

export function useSavingsReport(endMonth: MonthKey, months = 12) {
  const { db } = useLedger();
  return useDerived(() => savingsReport(db, endMonth, months, tz), [db, endMonth, months]);
}

export function useYearlyReport(year: number) {
  const { db } = useLedger();
  return useDerived(() => yearlyReport(db, year, tz), [db, year]);
}

export function useCalendar(month: MonthKey) {
  const { db } = useLedger();
  return useDerived(() => calendarMonth(db, month, tz), [db, month]);
}

/**
 * There are no sessions to list — nothing signs in and nothing is transmitted.
 * The hook stays so the Settings page can say so rather than crash.
 */
export function useSessions() {
  return useDerived(() => [] as never[], []);
}

// ────────────────────────────────────────────────────────────────  writes ───

export interface MutationConfig<TData, TVariables> {
  onSuccess?: (data: TData, variables: TVariables) => void;
  onError?: (error: Error, variables: TVariables) => void;
}

export interface Mutation<TData, TVariables> {
  mutate: (variables: TVariables, options?: MutationConfig<TData, TVariables>) => void;
  mutateAsync: (variables: TVariables) => Promise<TData>;
  isPending: boolean;
  error: Error | null;
  reset: () => void;
}

/**
 * Turns a synchronous ledger operation into the async mutation shape the forms
 * use.
 *
 * The work is synchronous, but the promise is real: a form that awaits it gets
 * a rejected promise carrying the `AppError` with its field issues, which is
 * exactly what the old network call did.
 */
function useOperation<TData, TVariables>(
  run: (variables: TVariables) => TData,
  config?: MutationConfig<TData, TVariables>,
): Mutation<TData, TVariables> {
  const [isPending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  // Keep the latest callbacks without re-creating the mutation every render.
  const configRef = useRef(config);
  configRef.current = config;
  const runRef = useRef(run);
  runRef.current = run;

  const mutateAsync = useCallback(async (variables: TVariables): Promise<TData> => {
    setPending(true);
    setError(null);
    try {
      const data = runRef.current(variables);
      configRef.current?.onSuccess?.(data, variables);
      return data;
    } catch (caught) {
      const failure =
        caught instanceof Error ? caught : new AppError('Something went wrong saving that.');
      setError(failure);
      configRef.current?.onError?.(failure, variables);
      throw failure;
    } finally {
      setPending(false);
    }
  }, []);

  const mutate = useCallback(
    (variables: TVariables, options?: MutationConfig<TData, TVariables>) => {
      void mutateAsync(variables)
        .then((data) => options?.onSuccess?.(data, variables))
        .catch((caught: Error) => options?.onError?.(caught, variables));
    },
    [mutateAsync],
  );

  return { mutate, mutateAsync, isPending, error, reset: () => setError(null) };
}

/** Amount fields arrive as the text the user typed. */
function useAmountParser(): (value: string | number | undefined, field?: string) => number {
  const { db } = useLedger();
  const currency = db.profile.currency;
  return useCallback(
    (value, field = 'amount') => {
      if (value === undefined || value === '') throw AppError.field(field, 'Enter an amount.');
      try {
        return parseAmountToMinor(value, currency);
      } catch (caught) {
        throw AppError.field(field, caught instanceof Error ? caught.message : 'That amount is not valid.');
      }
    },
    [currency],
  );
}

export interface TransactionInput {
  type: TransactionType;
  amount: string;
  accountId: string;
  toAccountId?: string | null;
  categoryId?: string | null;
  description: string;
  notes?: string | null;
  paymentMethod?: string;
  /** A `YYYY-MM-DD` from the date picker, or a full timestamp. */
  occurredAt?: string;
}

function toTimestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.length === 10 ? `${value}T12:00:00.000Z` : value;
}

export function useCreateTransaction(config?: MutationConfig<unknown, TransactionInput>) {
  const { apply } = useLedger();
  const amount = useAmountParser();
  return useOperation((input: TransactionInput) => {
    const result = apply((db) => {
      const created = ops.createTransaction(db, {
        ...input,
        amountMinor: amount(input.amount),
        paymentMethod: input.paymentMethod as never,
        ...(toTimestamp(input.occurredAt) ? { occurredAt: toTimestamp(input.occurredAt) } : {}),
      });
      // Alerts are raised as part of the same write, so a budget that tips over
      // is flagged on the very render that shows the transaction.
      return { db: evaluateAfterWrite(created.db, created.transaction), transaction: created.transaction };
    });
    return result?.transaction;
  }, config);
}

export function useUpdateTransaction(
  config?: MutationConfig<unknown, { id: string; patch: Partial<TransactionInput> }>,
) {
  const { apply } = useLedger();
  const amount = useAmountParser();
  return useOperation(({ id, patch }: { id: string; patch: Partial<TransactionInput> }) => {
    const { amount: typed, paymentMethod, occurredAt, ...rest } = patch;
    return apply((db) =>
      ops.updateTransaction(db, id, {
        ...rest,
        ...(typed !== undefined ? { amountMinor: amount(typed) } : {}),
        ...(paymentMethod !== undefined ? { paymentMethod: paymentMethod as never } : {}),
        ...(toTimestamp(occurredAt) ? { occurredAt: toTimestamp(occurredAt) } : {}),
      }));
  }, config);
}

export function useDeleteTransaction(config?: MutationConfig<void, string>) {
  const { apply } = useLedger();
  return useOperation((id: string) => {
    apply((db) => ops.deleteTransaction(db, id));
  }, config);
}

export interface AccountPayload {
  name: string;
  type: string;
  institution?: string | null;
  openingBalance?: string;
  color?: string;
  icon?: string;
  isDefault?: boolean;
  isArchived?: boolean;
  sortOrder?: number;
}

export function useCreateAccount(config?: MutationConfig<unknown, AccountPayload>) {
  const { apply } = useLedger();
  const amount = useAmountParser();
  return useOperation((input: AccountPayload) =>
    apply((db) =>
      ops.createAccount(db, {
        ...input,
        type: input.type as never,
        openingBalanceMinor: input.openingBalance ? amount(input.openingBalance, 'openingBalance') : 0,
      })), config);
}

export function useUpdateAccount(
  config?: MutationConfig<unknown, { id: string; patch: Partial<AccountPayload> }>,
) {
  const { apply } = useLedger();
  const amount = useAmountParser();
  return useOperation(({ id, patch }: { id: string; patch: Partial<AccountPayload> }) => {
    const { openingBalance, type, ...rest } = patch;
    return apply((db) =>
      ops.updateAccount(db, id, {
        ...rest,
        ...(type !== undefined ? { type: type as never } : {}),
        ...(openingBalance !== undefined
          ? { openingBalanceMinor: amount(openingBalance, 'openingBalance') }
          : {}),
      }));
  }, config);
}

export function useDeleteAccount(config?: MutationConfig<void, string>) {
  const { apply } = useLedger();
  return useOperation((id: string) => {
    apply((db) => ops.deleteAccount(db, id));
  }, config);
}

export function useCreateCategory(config?: MutationConfig<unknown, Record<string, unknown>>) {
  const { apply } = useLedger();
  return useOperation((input: Record<string, unknown>) =>
    apply((db) => ops.createCategory(db, input as never)), config);
}

export function useUpdateCategory(
  config?: MutationConfig<unknown, { id: string; patch: Record<string, unknown> }>,
) {
  const { apply } = useLedger();
  return useOperation(({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
    apply((db) => ops.updateCategory(db, id, patch as never)), config);
}

export function useDeleteCategory(config?: MutationConfig<void, { id: string; reassignTo?: string }>) {
  const { apply } = useLedger();
  return useOperation(({ id, reassignTo }: { id: string; reassignTo?: string }) => {
    apply((db) => ops.deleteCategory(db, id, reassignTo));
  }, config);
}

export interface BudgetPayload {
  name: string;
  period: string;
  limit: string;
  categoryIds: string[];
  alertThresholdPct?: number;
  color?: string;
  isActive?: boolean;
}

export function useCreateBudget(config?: MutationConfig<unknown, BudgetPayload>) {
  const { apply } = useLedger();
  const amount = useAmountParser();
  return useOperation((input: BudgetPayload) =>
    apply((db) =>
      ops.createBudget(db, {
        ...input,
        period: input.period as never,
        limitMinor: amount(input.limit, 'limit'),
      })), config);
}

export function useUpdateBudget(
  config?: MutationConfig<unknown, { id: string; patch: Partial<BudgetPayload> }>,
) {
  const { apply } = useLedger();
  const amount = useAmountParser();
  return useOperation(({ id, patch }: { id: string; patch: Partial<BudgetPayload> }) => {
    const { limit, period, ...rest } = patch;
    return apply((db) =>
      ops.updateBudget(db, id, {
        ...rest,
        ...(period !== undefined ? { period: period as never } : {}),
        ...(limit !== undefined ? { limitMinor: amount(limit, 'limit') } : {}),
      }));
  }, config);
}

export function useDeleteBudget(config?: MutationConfig<void, string>) {
  const { apply } = useLedger();
  return useOperation((id: string) => {
    apply((db) => ops.deleteBudget(db, id));
  }, config);
}

export interface GoalPayload {
  name: string;
  target?: string;
  description?: string | null;
  targetDate?: string | null;
  color?: string;
  icon?: string;
  initialSaved?: string;
  status?: string;
}

export function useCreateGoal(config?: MutationConfig<unknown, GoalPayload>) {
  const { apply } = useLedger();
  const amount = useAmountParser();
  return useOperation((input: GoalPayload) =>
    apply((db) =>
      ops.createGoal(db, {
        ...input,
        targetMinor: amount(input.target, 'target'),
        ...(input.initialSaved ? { initialSavedMinor: amount(input.initialSaved, 'initialSaved') } : {}),
      })), config);
}

export function useUpdateGoal(
  config?: MutationConfig<unknown, { id: string; patch: Partial<GoalPayload> }>,
) {
  const { apply } = useLedger();
  const amount = useAmountParser();
  return useOperation(({ id, patch }: { id: string; patch: Partial<GoalPayload> }) => {
    const { target, status, initialSaved, ...rest } = patch;
    return apply((db) =>
      ops.updateGoal(db, id, {
        ...rest,
        ...(target !== undefined ? { targetMinor: amount(target, 'target') } : {}),
        ...(status !== undefined ? { status: status as never } : {}),
      }));
  }, config);
}

export function useDeleteGoal(config?: MutationConfig<void, string>) {
  const { apply } = useLedger();
  return useOperation((id: string) => {
    apply((db) => ops.deleteGoal(db, id));
  }, config);
}

export function useAddContribution(
  config?: MutationConfig<void, { goalId: string; amount: string; note?: string }>,
) {
  const { apply } = useLedger();
  const parse = useAmountParser();
  return useOperation(({ goalId, amount, note }: { goalId: string; amount: string; note?: string }) => {
    apply((db) => ops.addGoalContribution(db, goalId, { amountMinor: parse(amount), note: note ?? null }));
  }, config);
}

export interface RecurringPayload {
  type: string;
  amount: string;
  accountId: string;
  toAccountId?: string | null;
  categoryId?: string | null;
  description: string;
  notes?: string | null;
  paymentMethod?: string;
  frequency: string;
  intervalCount?: number;
  startDate: string;
  endDate?: string | null;
  isSubscription?: boolean;
  merchant?: string | null;
  autoPost?: boolean;
  isActive?: boolean;
}

export function useCreateRecurring(config?: MutationConfig<unknown, RecurringPayload>) {
  const { apply } = useLedger();
  const amount = useAmountParser();
  return useOperation((input: RecurringPayload) =>
    apply((db) =>
      ops.createRecurring(db, {
        ...input,
        type: input.type as never,
        frequency: input.frequency as never,
        paymentMethod: input.paymentMethod as never,
        amountMinor: amount(input.amount),
      })), config);
}

export function useUpdateRecurring(
  config?: MutationConfig<unknown, { id: string; patch: Partial<RecurringPayload> }>,
) {
  const { apply } = useLedger();
  const amount = useAmountParser();
  return useOperation(({ id, patch }: { id: string; patch: Partial<RecurringPayload> }) => {
    const { amount: typed, type, frequency, paymentMethod, ...rest } = patch;
    return apply((db) =>
      ops.updateRecurring(db, id, {
        ...rest,
        ...(type !== undefined ? { type: type as never } : {}),
        ...(frequency !== undefined ? { frequency: frequency as never } : {}),
        ...(paymentMethod !== undefined ? { paymentMethod: paymentMethod as never } : {}),
        ...(typed !== undefined ? { amountMinor: amount(typed) } : {}),
      }));
  }, config);
}

export function useDeleteRecurring(config?: MutationConfig<void, string>) {
  const { apply } = useLedger();
  return useOperation((id: string) => {
    apply((db) => ops.deleteRecurring(db, id));
  }, config);
}

/** Posts the occurrence a schedule currently owes — the "run now" button. */
export function useRunRecurring(config?: MutationConfig<{ posted: number }, string>) {
  const { apply } = useLedger();
  return useOperation((id: string) => {
    let posted = 0;
    apply((db) => {
      const rule = db.recurring.find((r) => r.id === id);
      const due = rule?.nextRunOn ?? todayKey();
      const next = postOccurrence(db, id, due);
      posted = next === db ? 0 : 1;
      return next;
    });
    return { posted };
  }, config);
}

export interface DebtPayload {
  direction: string;
  counterparty: string;
  amount?: string;
  description?: string | null;
  dueDate?: string | null;
  isWrittenOff?: boolean;
}

export function useCreateDebt(config?: MutationConfig<unknown, DebtPayload>) {
  const { apply } = useLedger();
  const amount = useAmountParser();
  return useOperation((input: DebtPayload) =>
    apply((db) =>
      ops.createDebt(db, {
        ...input,
        direction: input.direction as never,
        principalMinor: amount(input.amount),
      })), config);
}

export function useUpdateDebt(
  config?: MutationConfig<unknown, { id: string; patch: Partial<DebtPayload> }>,
) {
  const { apply } = useLedger();
  const amount = useAmountParser();
  return useOperation(({ id, patch }: { id: string; patch: Partial<DebtPayload> }) => {
    const { amount: typed, direction, ...rest } = patch;
    return apply((db) =>
      ops.updateDebt(db, id, {
        ...rest,
        ...(direction !== undefined ? { direction: direction as never } : {}),
        ...(typed !== undefined ? { principalMinor: amount(typed) } : {}),
      }));
  }, config);
}

export function useDeleteDebt(config?: MutationConfig<void, string>) {
  const { apply } = useLedger();
  return useOperation((id: string) => {
    apply((db) => ops.deleteDebt(db, id));
  }, config);
}

export interface RepaymentPayload {
  debtId: string;
  amount: string;
  paidOn?: string;
  note?: string | null;
  accountId?: string;
  categoryId?: string;
}

export function useAddRepayment(config?: MutationConfig<void, RepaymentPayload>) {
  const { apply } = useLedger();
  const parse = useAmountParser();
  return useOperation(({ debtId, amount, ...rest }: RepaymentPayload) => {
    apply((db) => ops.addRepayment(db, debtId, { ...rest, amountMinor: parse(amount) }));
  }, config);
}

export interface ProfilePayload {
  name?: string;
  fullName?: string;
  currency?: string;
  theme?: string;
  moneyPurpose?: string | null;
  notificationPrefs?: Record<string, boolean>;
  largeExpenseThreshold?: string;
}

export function useUpdateProfile(config?: MutationConfig<unknown, ProfilePayload>) {
  const { apply } = useLedger();
  const amount = useAmountParser();
  return useOperation((patch: ProfilePayload) =>
    apply((db) =>
      ops.updateProfile(db, {
        ...(patch.fullName !== undefined ? { name: patch.fullName } : {}),
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
        ...(patch.theme !== undefined ? { theme: patch.theme as never } : {}),
        ...(patch.moneyPurpose !== undefined ? { moneyPurpose: patch.moneyPurpose as never } : {}),
        ...(patch.notificationPrefs !== undefined ? { notificationPrefs: patch.notificationPrefs } : {}),
        ...(patch.largeExpenseThreshold !== undefined
          ? { largeExpenseThresholdMinor: amount(patch.largeExpenseThreshold, 'largeExpenseThreshold') }
          : {}),
      })), config);
}

export function useMarkNotificationRead() {
  const { apply } = useLedger();
  return useOperation((id: string) => {
    apply((db) => ops.markNotificationRead(db, id));
  });
}

export function useMarkAllNotificationsRead() {
  const { apply } = useLedger();
  return useOperation((_?: void) => {
    apply((db) => ops.markAllNotificationsRead(db));
  });
}

/** Fills an empty app with three months of plausible activity. */
export function useLoadSampleData() {
  const { apply } = useLedger();
  return useOperation((_?: void) => {
    apply((db) => withSampleData(db));
  });
}

export function useClearSampleData() {
  const { apply } = useLedger();
  return useOperation((_?: void) => {
    let deleted = 0;
    apply((db) => {
      const result = ops.clearSampleTransactions(db);
      deleted = result.removed;
      return result.db;
    });
    return { deleted };
  });
}

export { currentMonthKey };
export type { AccountView, BudgetView, DebtView, GoalView, RecurringView };
