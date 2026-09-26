/**
 * The whole data model, in one file.
 *
 * Every monetary value is an integer count of *minor units* — paise for INR,
 * cents for USD — and is always named with a `Minor` suffix, so a formatting
 * mistake is visible at the call site. There is no floating point anywhere in
 * the money path.
 *
 * Dates come in two flavours and the distinction matters:
 *   • `DateKey` is a calendar day, `YYYY-MM-DD`. Used where the day is the
 *     fact: a due date, a budget period, a contribution.
 *   • `Timestamp` is an ISO-8601 instant. Used where the moment matters, which
 *     is only transactions.
 */

export type MinorUnits = number;
/** `YYYY-MM-DD` */
export type DateKey = string;
/** `YYYY-MM` */
export type MonthKey = string;
/** ISO-8601 instant */
export type Timestamp = string;

export type TransactionType = 'income' | 'expense' | 'transfer' | 'adjustment';
export type CategoryKind = 'income' | 'expense';

export type AccountType =
  | 'cash' | 'bank' | 'wallet' | 'credit_card' | 'savings' | 'investment' | 'other';

export type PaymentMethod =
  | 'cash' | 'upi' | 'debit_card' | 'credit_card' | 'bank_transfer'
  | 'netbanking' | 'cheque' | 'auto_debit' | 'other';

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type Theme = 'light' | 'dark' | 'system';
export type BudgetPeriod = 'weekly' | 'monthly' | 'yearly';
export type BudgetStatus = 'on_track' | 'warning' | 'exceeded';
export type GoalStatus = 'active' | 'achieved' | 'archived';
export type DebtDirection = 'i_owe' | 'owed_to_me';
export type DebtStatus = 'pending' | 'partially_paid' | 'paid' | 'written_off';

export const MONEY_PURPOSES = [
  'personal', 'family', 'business', 'student', 'freelance', 'other',
] as const;
export type MoneyPurpose = (typeof MONEY_PURPOSES)[number];

// ── Stored records ──────────────────────────────────────────────────────────

export interface Profile {
  name: string;
  currency: string;
  theme: Theme;
  moneyPurpose: MoneyPurpose | null;
  /** Null until the first-run wizard has been completed. */
  setupCompletedAt: Timestamp | null;
  notificationPrefs: Record<string, boolean>;
  largeExpenseThresholdMinor: MinorUnits;
  createdAt: Timestamp;
}

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  institution: string | null;
  color: string;
  icon: string;
  openingBalanceMinor: MinorUnits;
  isDefault: boolean;
  isArchived: boolean;
  sortOrder: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  icon: string;
  color: string;
  isSystem: boolean;
  isArchived: boolean;
  sortOrder: number;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  /** Positive for income, expense and transfer. Signed, non-zero, for adjustments. */
  amountMinor: MinorUnits;
  accountId: string;
  /** Transfers only. */
  toAccountId: string | null;
  /** Income and expense only. */
  categoryId: string | null;
  description: string;
  notes: string | null;
  paymentMethod: PaymentMethod;
  occurredAt: Timestamp;
  /** Marks rows created by the sample-data preview, so they can be cleared. */
  isSample: boolean;
  source: 'manual' | 'recurring' | 'debt' | 'import' | 'sample';
  recurringId: string | null;
  debtPaymentId: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Budget {
  id: string;
  name: string;
  period: BudgetPeriod;
  limitMinor: MinorUnits;
  categoryIds: string[];
  alertThresholdPct: number;
  color: string;
  isActive: boolean;
  createdAt: Timestamp;
}

export interface Goal {
  id: string;
  name: string;
  description: string | null;
  targetMinor: MinorUnits;
  targetDate: DateKey | null;
  color: string;
  icon: string;
  status: GoalStatus;
  createdAt: Timestamp;
}

export interface GoalContribution {
  id: string;
  goalId: string;
  /** Signed: negative takes money back out of the goal. */
  amountMinor: MinorUnits;
  occurredOn: DateKey;
  note: string | null;
  createdAt: Timestamp;
}

export interface Recurring {
  id: string;
  type: 'income' | 'expense' | 'transfer';
  amountMinor: MinorUnits;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  description: string;
  notes: string | null;
  paymentMethod: PaymentMethod;
  frequency: Frequency;
  intervalCount: number;
  startDate: DateKey;
  endDate: DateKey | null;
  nextRunOn: DateKey | null;
  lastRunOn: DateKey | null;
  isSubscription: boolean;
  merchant: string | null;
  autoPost: boolean;
  isActive: boolean;
  createdAt: Timestamp;
}

/**
 * One row per posted occurrence. The (recurringId, scheduledFor) pair is
 * unique, which is what makes posting idempotent — see `core/recurring.ts`.
 */
export interface RecurringRun {
  recurringId: string;
  scheduledFor: DateKey;
  transactionId: string;
  createdAt: Timestamp;
}

export interface Debt {
  id: string;
  direction: DebtDirection;
  counterparty: string;
  principalMinor: MinorUnits;
  description: string | null;
  dueDate: DateKey | null;
  isWrittenOff: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface DebtPayment {
  id: string;
  debtId: string;
  amountMinor: MinorUnits;
  paidOn: DateKey;
  note: string | null;
  transactionId: string | null;
  createdAt: Timestamp;
}

export interface AppNotification {
  id: string;
  type:
    | 'budget_warning' | 'budget_exceeded' | 'recurring_due' | 'debt_due'
    | 'goal_milestone' | 'goal_achieved' | 'large_expense' | 'system';
  severity: 'info' | 'warning' | 'critical' | 'success';
  title: string;
  body: string;
  payload: Record<string, unknown>;
  /** Stops the same alert being raised twice for the same period. */
  dedupeKey: string | null;
  readAt: Timestamp | null;
  createdAt: Timestamp;
}

/** Everything the app knows, in one serialisable object. */
export interface Database {
  schemaVersion: number;
  profile: Profile;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
  goals: Goal[];
  goalContributions: GoalContribution[];
  recurring: Recurring[];
  recurringRuns: RecurringRun[];
  debts: Debt[];
  debtPayments: DebtPayment[];
  notifications: AppNotification[];
}

// ── Derived views ───────────────────────────────────────────────────────────

/**
 * The effect of one transaction on one account. Derived, never stored — which
 * is why an edit cannot double-count and a delete cannot leave a residue.
 */
export interface LedgerEntry {
  transactionId: string;
  accountId: string;
  deltaMinor: MinorUnits;
  role: 'primary' | 'transfer_out' | 'transfer_in';
  occurredAt: Timestamp;
}

export interface AccountView extends Account {
  balanceMinor: MinorUnits;
  transactionCount: number;
  currency: string;
}

export interface CategoryRef {
  id: string;
  name: string;
  icon: string;
  color: string;
}

export interface TransactionView extends Omit<Transaction, 'categoryId' | 'accountId' | 'toAccountId'> {
  /** Effect on overall net worth: +income, −expense, 0 for a transfer. */
  signedAmountMinor: MinorUnits;
  currency: string;
  category: CategoryRef | null;
  account: CategoryRef & { type: AccountType };
  toAccount: CategoryRef | null;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  isRecurring: boolean;
  runningBalanceMinor?: MinorUnits;
}

export interface PeriodTotals {
  incomeMinor: MinorUnits;
  expenseMinor: MinorUnits;
  adjustmentMinor: MinorUnits;
  transferMinor: MinorUnits;
  netMinor: MinorUnits;
  incomeCount: number;
  expenseCount: number;
}

export interface CategorySlice {
  categoryId: string;
  name: string;
  icon: string;
  color: string;
  amountMinor: MinorUnits;
  transactionCount: number;
  /** Basis points of the kind's total. 10 000 = 100%. */
  shareBps: number;
}

export interface DailyPoint {
  date: DateKey;
  incomeMinor: MinorUnits;
  expenseMinor: MinorUnits;
  netMinor: MinorUnits;
  transactionCount: number;
}

export interface MonthlyPoint {
  month: MonthKey;
  incomeMinor: MinorUnits;
  expenseMinor: MinorUnits;
  netMinor: MinorUnits;
}

export interface BalancePoint {
  date: DateKey;
  balanceMinor: MinorUnits;
}

export interface BudgetView extends Budget {
  spentMinor: MinorUnits;
  remainingMinor: MinorUnits;
  usedBps: number;
  status: BudgetStatus;
  periodStart: DateKey;
  periodEnd: DateKey;
  daysRemaining: number;
  safeDailyMinor: MinorUnits;
  categories: CategoryRef[];
}

export interface GoalView extends Goal {
  savedMinor: MinorUnits;
  remainingMinor: MinorUnits;
  progressBps: number;
  monthlyNeededMinor: MinorUnits | null;
  daysRemaining: number | null;
  contributions: GoalContribution[];
}

export interface RecurringView extends Recurring {
  monthlyEquivalentMinor: MinorUnits;
  yearlyEquivalentMinor: MinorUnits;
  category: CategoryRef | null;
  account: CategoryRef;
  toAccount: { id: string; name: string } | null;
  isDue: boolean;
}

export interface DebtView extends Debt {
  paidMinor: MinorUnits;
  outstandingMinor: MinorUnits;
  progressBps: number;
  status: DebtStatus;
  isOverdue: boolean;
  payments: DebtPayment[];
}

export interface DateRange {
  from: DateKey;
  to: DateKey;
}
