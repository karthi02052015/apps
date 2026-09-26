/**
 * Every write the application can perform.
 *
 * Each operation takes the current database and returns a new one — the old
 * value is never mutated. That gives React a reliable change signal, makes
 * undo trivial to add later, and means a failed validation leaves the previous
 * state completely untouched.
 *
 * Validation lives here rather than in the forms, so the same rules apply
 * whether a record arrives from the UI, from the recurring poster, or from an
 * imported backup.
 */
import { AppError, type FieldIssue } from '../lib/errors';
import { assertMinor } from './money';
import { addDays, dateKeyToTimestamp, isValidDateKey, todayKey } from './dates';
import { accountUsage } from './ledger';
import type {
  Account, AccountType, AppNotification, Budget, BudgetPeriod, Category, CategoryKind,
  Database, Debt, DebtDirection, DebtPayment, Frequency, Goal, GoalContribution,
  MinorUnits, PaymentMethod, Recurring, Transaction, TransactionType,
} from './types';

const now = (): string => new Date().toISOString();

export function newId(): string {
  // `randomUUID` needs a secure context; the fallback keeps the app working on
  // plain http (a LAN address, or a file:// open) where it is unavailable.
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID();
  const bytes = new Uint8Array(16);
  if (cryptoObj?.getRandomValues) cryptoObj.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Replaces one record in a list by id, or throws if it is not there. */
function replaceById<T extends { id: string }>(items: T[], id: string, update: (item: T) => T, label: string): T[] {
  let found = false;
  const next = items.map((item) => {
    if (item.id !== id) return item;
    found = true;
    return update(item);
  });
  if (!found) throw new AppError(`That ${label} no longer exists.`);
  return next;
}

// ── Transactions ────────────────────────────────────────────────────────────

export interface TransactionInput {
  type: TransactionType;
  amountMinor: MinorUnits;
  accountId: string;
  toAccountId?: string | null;
  categoryId?: string | null;
  description: string;
  notes?: string | null;
  paymentMethod?: PaymentMethod;
  occurredAt?: string;
  isSample?: boolean;
  source?: Transaction['source'];
  recurringId?: string | null;
  debtPaymentId?: string | null;
}

/**
 * The shape rules, applied identically to manual entry, recurring posting,
 * debt repayments and imports.
 */
export function validateTransaction(db: Database, input: TransactionInput): void {
  const issues: FieldIssue[] = [];

  try {
    assertMinor(input.amountMinor, 'Amount');
  } catch {
    issues.push({ field: 'amount', message: 'Enter a valid amount.' });
  }

  if (input.type !== 'adjustment' && input.amountMinor <= 0) {
    issues.push({ field: 'amount', message: 'Amount must be greater than zero.' });
  }
  if (input.type === 'adjustment' && input.amountMinor === 0) {
    issues.push({ field: 'amount', message: 'An adjustment cannot be zero.' });
  }

  const account = db.accounts.find((a) => a.id === input.accountId);
  if (!account) issues.push({ field: 'accountId', message: 'Choose an account.' });

  if (input.type === 'transfer') {
    if (!input.toAccountId) {
      issues.push({ field: 'toAccountId', message: 'Choose the account to transfer to.' });
    } else if (input.toAccountId === input.accountId) {
      issues.push({ field: 'toAccountId', message: 'Choose two different accounts.' });
    } else if (!db.accounts.some((a) => a.id === input.toAccountId)) {
      issues.push({ field: 'toAccountId', message: 'That account does not exist.' });
    }
    if (input.categoryId) {
      issues.push({ field: 'categoryId', message: 'Transfers do not use a category.' });
    }
  } else if (input.toAccountId) {
    issues.push({ field: 'toAccountId', message: 'Only transfers have a destination account.' });
  }

  if (input.type === 'income' || input.type === 'expense') {
    const category = db.categories.find((c) => c.id === input.categoryId);
    if (!category) {
      issues.push({ field: 'categoryId', message: 'Choose a category.' });
    } else if (category.kind !== input.type) {
      issues.push({
        field: 'categoryId',
        message: `That is an ${category.kind} category — pick an ${input.type} one.`,
      });
    }
  } else if (input.categoryId) {
    issues.push({ field: 'categoryId', message: 'Adjustments and transfers do not use a category.' });
  }

  if (!input.description.trim()) {
    issues.push({ field: 'description', message: 'Add a short description.' });
  }
  if (input.description.length > 140) {
    issues.push({ field: 'description', message: 'Keep the description under 140 characters.' });
  }

  if (input.occurredAt && Number.isNaN(Date.parse(input.occurredAt))) {
    issues.push({ field: 'occurredAt', message: 'That date is not valid.' });
  }

  if (issues.length) throw AppError.fields(issues);
}

export function createTransaction(
  db: Database,
  input: TransactionInput,
): { db: Database; transaction: Transaction } {
  validateTransaction(db, input);
  const timestamp = now();
  const transaction: Transaction = {
    id: newId(),
    type: input.type,
    amountMinor: input.amountMinor,
    accountId: input.accountId,
    toAccountId: input.type === 'transfer' ? (input.toAccountId ?? null) : null,
    categoryId: input.type === 'income' || input.type === 'expense' ? (input.categoryId ?? null) : null,
    description: input.description.trim(),
    notes: input.notes?.trim() || null,
    paymentMethod: input.paymentMethod ?? 'other',
    occurredAt: input.occurredAt ?? timestamp,
    isSample: input.isSample ?? false,
    source: input.source ?? 'manual',
    recurringId: input.recurringId ?? null,
    debtPaymentId: input.debtPaymentId ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return { db: { ...db, transactions: [...db.transactions, transaction] }, transaction };
}

/**
 * Editing re-validates the *merged* record rather than the patch, because
 * changing the type changes which of category and destination are legal.
 */
export function updateTransaction(
  db: Database,
  id: string,
  patch: Partial<TransactionInput>,
): { db: Database; transaction: Transaction } {
  const existing = db.transactions.find((t) => t.id === id);
  if (!existing) throw new AppError('That transaction no longer exists.');

  const type = patch.type ?? existing.type;
  const merged: TransactionInput = {
    type,
    amountMinor: patch.amountMinor ?? existing.amountMinor,
    accountId: patch.accountId ?? existing.accountId,
    toAccountId:
      type !== 'transfer'
        ? null
        : patch.toAccountId !== undefined
          ? patch.toAccountId
          : existing.toAccountId,
    categoryId:
      type === 'income' || type === 'expense'
        ? patch.categoryId !== undefined
          ? patch.categoryId
          : existing.categoryId
        : null,
    description: patch.description ?? existing.description,
    notes: patch.notes !== undefined ? patch.notes : existing.notes,
    paymentMethod: patch.paymentMethod ?? existing.paymentMethod,
    occurredAt: patch.occurredAt ?? existing.occurredAt,
  };

  // A type change can strand a now-illegal category; clear it before validating
  // so the user gets a "choose a category" prompt rather than a mismatch error.
  if (patch.type && patch.type !== existing.type && merged.categoryId) {
    const category = db.categories.find((c) => c.id === merged.categoryId);
    if (category && category.kind !== type) merged.categoryId = null;
  }

  validateTransaction(db, merged);

  const updated: Transaction = {
    ...existing,
    type: merged.type,
    amountMinor: merged.amountMinor,
    accountId: merged.accountId,
    toAccountId: merged.toAccountId ?? null,
    categoryId: merged.categoryId ?? null,
    description: merged.description.trim(),
    notes: merged.notes?.trim() || null,
    paymentMethod: merged.paymentMethod ?? 'other',
    occurredAt: merged.occurredAt ?? existing.occurredAt,
    updatedAt: now(),
  };

  return {
    db: { ...db, transactions: replaceById(db.transactions, id, () => updated, 'transaction') },
    transaction: updated,
  };
}

export function deleteTransaction(db: Database, id: string): Database {
  if (!db.transactions.some((t) => t.id === id)) {
    throw new AppError('That transaction no longer exists.');
  }
  return {
    ...db,
    transactions: db.transactions.filter((t) => t.id !== id),
    // A transfer's two legs live in one record, so nothing else needs undoing.
    // Links from recurring runs and debt payments are cleared so they do not
    // point at a transaction that is gone.
    recurringRuns: db.recurringRuns.filter((run) => run.transactionId !== id),
    debtPayments: db.debtPayments.map((payment) =>
      payment.transactionId === id ? { ...payment, transactionId: null } : payment),
  };
}

export function deleteTransactions(db: Database, ids: string[]): Database {
  return ids.reduce((current, id) => {
    try {
      return deleteTransaction(current, id);
    } catch {
      return current;
    }
  }, db);
}

export function clearSampleTransactions(db: Database): { db: Database; removed: number } {
  const remaining = db.transactions.filter((t) => !t.isSample);
  return {
    db: { ...db, transactions: remaining },
    removed: db.transactions.length - remaining.length,
  };
}

// ── Accounts ────────────────────────────────────────────────────────────────

export interface AccountInput {
  name: string;
  type: AccountType;
  institution?: string | null;
  openingBalanceMinor: MinorUnits;
  color?: string;
  icon?: string;
  isDefault?: boolean;
}

function assertUniqueAccountName(db: Database, name: string, exceptId?: string): void {
  const normalised = name.trim().toLowerCase();
  if (db.accounts.some((a) => a.id !== exceptId && a.name.trim().toLowerCase() === normalised)) {
    throw AppError.field('name', 'You already have an account with that name.');
  }
}

export function createAccount(db: Database, input: AccountInput): { db: Database; account: Account } {
  if (!input.name.trim()) throw AppError.field('name', 'Give the account a name.');
  assertUniqueAccountName(db, input.name);
  assertMinor(input.openingBalanceMinor, 'Opening balance');

  const timestamp = now();
  const account: Account = {
    id: newId(),
    name: input.name.trim(),
    type: input.type,
    institution: input.institution?.trim() || null,
    color: input.color ?? 'slate',
    icon: input.icon ?? 'wallet',
    openingBalanceMinor: input.openingBalanceMinor,
    isDefault: input.isDefault ?? db.accounts.length === 0,
    isArchived: false,
    sortOrder: db.accounts.reduce((max, a) => Math.max(max, a.sortOrder), -1) + 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const accounts = account.isDefault
    ? [...db.accounts.map((a) => ({ ...a, isDefault: false })), account]
    : [...db.accounts, account];

  return { db: { ...db, accounts }, account };
}

export function updateAccount(
  db: Database,
  id: string,
  patch: Partial<AccountInput> & { isArchived?: boolean; sortOrder?: number },
): Database {
  const existing = db.accounts.find((a) => a.id === id);
  if (!existing) throw new AppError('That account no longer exists.');
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw AppError.field('name', 'Give the account a name.');
    assertUniqueAccountName(db, patch.name, id);
  }
  if (patch.openingBalanceMinor !== undefined) {
    assertMinor(patch.openingBalanceMinor, 'Opening balance');
  }
  if (patch.isArchived && existing.isDefault) {
    throw new AppError('Make another account the default before archiving this one.');
  }

  let accounts = db.accounts;
  if (patch.isDefault) accounts = accounts.map((a) => ({ ...a, isDefault: a.id === id }));

  accounts = replaceById(accounts, id, (account) => ({
    ...account,
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.type !== undefined ? { type: patch.type } : {}),
    ...(patch.institution !== undefined ? { institution: patch.institution?.trim() || null } : {}),
    ...(patch.openingBalanceMinor !== undefined
      ? { openingBalanceMinor: patch.openingBalanceMinor } : {}),
    ...(patch.color !== undefined ? { color: patch.color } : {}),
    ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
    ...(patch.isArchived !== undefined ? { isArchived: patch.isArchived } : {}),
    ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
    updatedAt: now(),
  }), 'account');

  return { ...db, accounts };
}

/**
 * Deleting an account with history would silently rewrite the past, so it is
 * refused — the UI offers archiving instead, which keeps reports intact.
 */
export function deleteAccount(db: Database, id: string): Database {
  const account = db.accounts.find((a) => a.id === id);
  if (!account) throw new AppError('That account no longer exists.');

  const used = accountUsage(db).get(id) ?? 0;
  if (used > 0) {
    throw new AppError(
      `This account has ${used} transaction${used === 1 ? '' : 's'}. ` +
        'Archive it instead so your history stays intact.',
    );
  }
  if (db.accounts.length <= 1) throw new AppError('You need at least one account.');

  let accounts = db.accounts.filter((a) => a.id !== id);
  if (account.isDefault && accounts[0]) {
    accounts = accounts.map((a, index) => (index === 0 ? { ...a, isDefault: true } : a));
  }
  return { ...db, accounts };
}

export function reorderAccounts(db: Database, orderedIds: string[]): Database {
  const order = new Map(orderedIds.map((id, index) => [id, index]));
  return {
    ...db,
    accounts: db.accounts.map((account) => ({
      ...account,
      sortOrder: order.get(account.id) ?? account.sortOrder,
    })),
  };
}

// ── Categories ──────────────────────────────────────────────────────────────

export function createCategory(
  db: Database,
  input: { name: string; kind: CategoryKind; icon?: string; color?: string },
): { db: Database; category: Category } {
  if (!input.name.trim()) throw AppError.field('name', 'Give the category a name.');
  const normalised = input.name.trim().toLowerCase();
  if (db.categories.some((c) => c.kind === input.kind && c.name.trim().toLowerCase() === normalised)) {
    throw AppError.field('name', 'You already have a category with that name.');
  }

  const category: Category = {
    id: newId(),
    name: input.name.trim(),
    kind: input.kind,
    icon: input.icon ?? 'tag',
    color: input.color ?? 'slate',
    isSystem: false,
    isArchived: false,
    sortOrder:
      db.categories.filter((c) => c.kind === input.kind)
        .reduce((max, c) => Math.max(max, c.sortOrder), -1) + 1,
  };
  return { db: { ...db, categories: [...db.categories, category] }, category };
}

export function updateCategory(
  db: Database,
  id: string,
  patch: { name?: string; icon?: string; color?: string; isArchived?: boolean; sortOrder?: number },
): Database {
  if (patch.name !== undefined && !patch.name.trim()) {
    throw AppError.field('name', 'Give the category a name.');
  }
  return {
    ...db,
    categories: replaceById(db.categories, id, (category) => ({
      ...category,
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      ...(patch.isArchived !== undefined ? { isArchived: patch.isArchived } : {}),
      ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
    }), 'category'),
  };
}

export function categoryUsage(db: Database): Map<string, number> {
  const usage = new Map<string, number>();
  for (const transaction of db.transactions) {
    if (!transaction.categoryId) continue;
    usage.set(transaction.categoryId, (usage.get(transaction.categoryId) ?? 0) + 1);
  }
  return usage;
}

/** A category in use cannot simply vanish — it is either kept, or merged. */
export function deleteCategory(db: Database, id: string, reassignTo?: string): Database {
  const category = db.categories.find((c) => c.id === id);
  if (!category) throw new AppError('That category no longer exists.');

  const used = categoryUsage(db).get(id) ?? 0;
  if (used > 0) {
    if (!reassignTo) {
      throw new AppError(
        `${used} transaction${used === 1 ? ' uses' : 's use'} this category. ` +
          'Archive it, or choose a category to move them to.',
      );
    }
    const target = db.categories.find((c) => c.id === reassignTo);
    if (!target) throw new AppError('That category does not exist.');
    if (target.kind !== category.kind) {
      throw new AppError('You can only merge into a category of the same type.');
    }
  }

  const swap = (value: string | null) => (value === id ? (reassignTo ?? null) : value);

  return {
    ...db,
    categories: db.categories.filter((c) => c.id !== id),
    transactions: db.transactions.map((t) => ({ ...t, categoryId: swap(t.categoryId) })),
    recurring: db.recurring.map((r) => ({ ...r, categoryId: swap(r.categoryId) })),
    budgets: db.budgets.map((budget) => ({
      ...budget,
      categoryIds: Array.from(
        new Set(budget.categoryIds.map((c) => swap(c)).filter((c): c is string => c !== null)),
      ),
    })),
  };
}

// ── Budgets ─────────────────────────────────────────────────────────────────

export interface BudgetInput {
  name: string;
  period: BudgetPeriod;
  limitMinor: MinorUnits;
  categoryIds: string[];
  alertThresholdPct?: number;
  color?: string;
  isActive?: boolean;
}

function validateBudget(db: Database, input: Partial<BudgetInput>, exceptId?: string): void {
  const issues: FieldIssue[] = [];
  if (input.name !== undefined) {
    if (!input.name.trim()) issues.push({ field: 'name', message: 'Give the budget a name.' });
    else if (db.budgets.some((b) =>
      b.id !== exceptId && b.name.trim().toLowerCase() === input.name!.trim().toLowerCase())) {
      issues.push({ field: 'name', message: 'You already have a budget with that name.' });
    }
  }
  if (input.limitMinor !== undefined && input.limitMinor <= 0) {
    issues.push({ field: 'limit', message: 'The limit must be greater than zero.' });
  }
  if (input.categoryIds !== undefined) {
    if (input.categoryIds.length === 0) {
      issues.push({ field: 'categoryIds', message: 'Choose at least one category.' });
    } else if (!input.categoryIds.every((id) =>
      db.categories.some((c) => c.id === id && c.kind === 'expense'))) {
      issues.push({ field: 'categoryIds', message: 'Budgets can only track expense categories.' });
    }
  }
  if (issues.length) throw AppError.fields(issues);
}

export function createBudget(db: Database, input: BudgetInput): { db: Database; budget: Budget } {
  validateBudget(db, input);
  const budget: Budget = {
    id: newId(),
    name: input.name.trim(),
    period: input.period,
    limitMinor: input.limitMinor,
    categoryIds: [...new Set(input.categoryIds)],
    alertThresholdPct: input.alertThresholdPct ?? 80,
    color: input.color ?? 'indigo',
    isActive: input.isActive ?? true,
    createdAt: now(),
  };
  return { db: { ...db, budgets: [...db.budgets, budget] }, budget };
}

export function updateBudget(db: Database, id: string, patch: Partial<BudgetInput>): Database {
  validateBudget(db, patch, id);
  return {
    ...db,
    budgets: replaceById(db.budgets, id, (budget) => ({
      ...budget,
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.period !== undefined ? { period: patch.period } : {}),
      ...(patch.limitMinor !== undefined ? { limitMinor: patch.limitMinor } : {}),
      ...(patch.categoryIds !== undefined ? { categoryIds: [...new Set(patch.categoryIds)] } : {}),
      ...(patch.alertThresholdPct !== undefined ? { alertThresholdPct: patch.alertThresholdPct } : {}),
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
    }), 'budget'),
  };
}

export function deleteBudget(db: Database, id: string): Database {
  return { ...db, budgets: db.budgets.filter((b) => b.id !== id) };
}

// ── Goals ───────────────────────────────────────────────────────────────────

export interface GoalInput {
  name: string;
  description?: string | null;
  targetMinor: MinorUnits;
  targetDate?: string | null;
  color?: string;
  icon?: string;
  initialSavedMinor?: MinorUnits;
}

export function createGoal(db: Database, input: GoalInput): { db: Database; goal: Goal } {
  const issues: FieldIssue[] = [];
  if (!input.name.trim()) issues.push({ field: 'name', message: 'Give the goal a name.' });
  if (input.targetMinor <= 0) {
    issues.push({ field: 'target', message: 'The target must be greater than zero.' });
  }
  if (input.targetDate && !isValidDateKey(input.targetDate)) {
    issues.push({ field: 'targetDate', message: 'That date is not valid.' });
  }
  if (db.goals.some((g) => g.name.trim().toLowerCase() === input.name.trim().toLowerCase())) {
    issues.push({ field: 'name', message: 'You already have a goal with that name.' });
  }
  if (issues.length) throw AppError.fields(issues);

  const goal: Goal = {
    id: newId(),
    name: input.name.trim(),
    description: input.description?.trim() || null,
    targetMinor: input.targetMinor,
    targetDate: input.targetDate || null,
    color: input.color ?? 'emerald',
    icon: input.icon ?? 'target',
    status: 'active',
    createdAt: now(),
  };

  const goalContributions = input.initialSavedMinor
    ? [...db.goalContributions, {
        id: newId(),
        goalId: goal.id,
        amountMinor: input.initialSavedMinor,
        occurredOn: todayKey(),
        note: 'Starting amount',
        createdAt: now(),
      } satisfies GoalContribution]
    : db.goalContributions;

  return { db: { ...db, goals: [...db.goals, goal], goalContributions }, goal };
}

export function updateGoal(
  db: Database,
  id: string,
  patch: Partial<Omit<GoalInput, 'initialSavedMinor'>> & { status?: Goal['status'] },
): Database {
  if (patch.targetMinor !== undefined && patch.targetMinor <= 0) {
    throw AppError.field('target', 'The target must be greater than zero.');
  }
  return {
    ...db,
    goals: replaceById(db.goals, id, (goal) => ({
      ...goal,
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.description !== undefined ? { description: patch.description?.trim() || null } : {}),
      ...(patch.targetMinor !== undefined ? { targetMinor: patch.targetMinor } : {}),
      ...(patch.targetDate !== undefined ? { targetDate: patch.targetDate || null } : {}),
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
    }), 'goal'),
  };
}

export function deleteGoal(db: Database, id: string): Database {
  return {
    ...db,
    goals: db.goals.filter((g) => g.id !== id),
    goalContributions: db.goalContributions.filter((c) => c.goalId !== id),
  };
}

export function addGoalContribution(
  db: Database,
  goalId: string,
  input: { amountMinor: MinorUnits; occurredOn?: string; note?: string | null },
): Database {
  if (!db.goals.some((g) => g.id === goalId)) throw new AppError('That goal no longer exists.');
  if (input.amountMinor === 0) throw AppError.field('amount', 'A contribution cannot be zero.');
  assertMinor(input.amountMinor, 'Contribution');

  const contribution: GoalContribution = {
    id: newId(),
    goalId,
    amountMinor: input.amountMinor,
    occurredOn: input.occurredOn && isValidDateKey(input.occurredOn) ? input.occurredOn : todayKey(),
    note: input.note?.trim() || null,
    createdAt: now(),
  };
  return { ...db, goalContributions: [...db.goalContributions, contribution] };
}

export function deleteGoalContribution(db: Database, id: string): Database {
  return { ...db, goalContributions: db.goalContributions.filter((c) => c.id !== id) };
}

// ── Recurring ───────────────────────────────────────────────────────────────

export interface RecurringInput {
  type: 'income' | 'expense' | 'transfer';
  amountMinor: MinorUnits;
  accountId: string;
  toAccountId?: string | null;
  categoryId?: string | null;
  description: string;
  notes?: string | null;
  paymentMethod?: PaymentMethod;
  frequency: Frequency;
  intervalCount?: number;
  startDate: string;
  endDate?: string | null;
  isSubscription?: boolean;
  merchant?: string | null;
  autoPost?: boolean;
  isActive?: boolean;
}

/** The first occurrence on or after `startDate`, respecting `endDate`. */
export function firstOccurrence(input: {
  startDate: string;
  endDate?: string | null;
}): string | null {
  if (input.endDate && input.startDate > input.endDate) return null;
  return input.startDate;
}

function validateRecurring(db: Database, input: Partial<RecurringInput>): void {
  const issues: FieldIssue[] = [];
  if (input.amountMinor !== undefined && input.amountMinor <= 0) {
    issues.push({ field: 'amount', message: 'Amount must be greater than zero.' });
  }
  if (input.description !== undefined && !input.description.trim()) {
    issues.push({ field: 'description', message: 'Add a description.' });
  }
  if (input.accountId !== undefined && !db.accounts.some((a) => a.id === input.accountId)) {
    issues.push({ field: 'accountId', message: 'Choose an account.' });
  }
  if (input.type === 'transfer') {
    if (!input.toAccountId) {
      issues.push({ field: 'toAccountId', message: 'Choose the account to transfer to.' });
    } else if (input.toAccountId === input.accountId) {
      issues.push({ field: 'toAccountId', message: 'Choose two different accounts.' });
    }
  } else if (input.type !== undefined && !input.categoryId) {
    issues.push({ field: 'categoryId', message: 'Choose a category.' });
  }
  if (input.startDate !== undefined && !isValidDateKey(input.startDate)) {
    issues.push({ field: 'startDate', message: 'That start date is not valid.' });
  }
  if (input.endDate && !isValidDateKey(input.endDate)) {
    issues.push({ field: 'endDate', message: 'That end date is not valid.' });
  }
  if (input.startDate && input.endDate && input.endDate < input.startDate) {
    issues.push({ field: 'endDate', message: 'The end date must be after the start date.' });
  }
  if (input.intervalCount !== undefined && (input.intervalCount < 1 || input.intervalCount > 52)) {
    issues.push({ field: 'intervalCount', message: 'Use an interval between 1 and 52.' });
  }
  if (issues.length) throw AppError.fields(issues);
}

export function createRecurring(
  db: Database,
  input: RecurringInput,
): { db: Database; recurring: Recurring } {
  validateRecurring(db, input);
  const recurring: Recurring = {
    id: newId(),
    type: input.type,
    amountMinor: input.amountMinor,
    accountId: input.accountId,
    toAccountId: input.type === 'transfer' ? (input.toAccountId ?? null) : null,
    categoryId: input.type === 'transfer' ? null : (input.categoryId ?? null),
    description: input.description.trim(),
    notes: input.notes?.trim() || null,
    paymentMethod: input.paymentMethod ?? 'other',
    frequency: input.frequency,
    intervalCount: input.intervalCount ?? 1,
    startDate: input.startDate,
    endDate: input.endDate || null,
    nextRunOn: firstOccurrence(input),
    lastRunOn: null,
    isSubscription: input.isSubscription ?? false,
    merchant: input.merchant?.trim() || null,
    autoPost: input.autoPost ?? true,
    isActive: input.isActive ?? true,
    createdAt: now(),
  };
  return { db: { ...db, recurring: [...db.recurring, recurring] }, recurring };
}

export function updateRecurring(
  db: Database,
  id: string,
  patch: Partial<RecurringInput>,
): Database {
  const existing = db.recurring.find((r) => r.id === id);
  if (!existing) throw new AppError('That schedule no longer exists.');
  validateRecurring(db, { ...existing, ...patch });

  const merged: Recurring = {
    ...existing,
    ...(patch.type !== undefined ? { type: patch.type } : {}),
    ...(patch.amountMinor !== undefined ? { amountMinor: patch.amountMinor } : {}),
    ...(patch.accountId !== undefined ? { accountId: patch.accountId } : {}),
    ...(patch.toAccountId !== undefined ? { toAccountId: patch.toAccountId } : {}),
    ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}),
    ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes?.trim() || null } : {}),
    ...(patch.paymentMethod !== undefined ? { paymentMethod: patch.paymentMethod } : {}),
    ...(patch.frequency !== undefined ? { frequency: patch.frequency } : {}),
    ...(patch.intervalCount !== undefined ? { intervalCount: patch.intervalCount } : {}),
    ...(patch.startDate !== undefined ? { startDate: patch.startDate } : {}),
    ...(patch.endDate !== undefined ? { endDate: patch.endDate || null } : {}),
    ...(patch.isSubscription !== undefined ? { isSubscription: patch.isSubscription } : {}),
    ...(patch.merchant !== undefined ? { merchant: patch.merchant?.trim() || null } : {}),
    ...(patch.autoPost !== undefined ? { autoPost: patch.autoPost } : {}),
    ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
  };

  // Keep the shape consistent when the type changes.
  if (merged.type === 'transfer') merged.categoryId = null;
  else merged.toAccountId = null;

  return { ...db, recurring: replaceById(db.recurring, id, () => merged, 'schedule') };
}

export function deleteRecurring(db: Database, id: string): Database {
  return {
    ...db,
    recurring: db.recurring.filter((r) => r.id !== id),
    recurringRuns: db.recurringRuns.filter((run) => run.recurringId !== id),
    // Transactions it already created are history and stay put; the link is cut.
    transactions: db.transactions.map((t) =>
      t.recurringId === id ? { ...t, recurringId: null } : t),
  };
}

// ── Debts ───────────────────────────────────────────────────────────────────

export interface DebtInput {
  direction: DebtDirection;
  counterparty: string;
  principalMinor: MinorUnits;
  description?: string | null;
  dueDate?: string | null;
  isWrittenOff?: boolean;
}

export function createDebt(db: Database, input: DebtInput): { db: Database; debt: Debt } {
  const issues: FieldIssue[] = [];
  if (!input.counterparty.trim()) {
    issues.push({ field: 'counterparty', message: 'Who is this with?' });
  }
  if (input.principalMinor <= 0) {
    issues.push({ field: 'amount', message: 'The amount must be greater than zero.' });
  }
  if (input.dueDate && !isValidDateKey(input.dueDate)) {
    issues.push({ field: 'dueDate', message: 'That date is not valid.' });
  }
  if (issues.length) throw AppError.fields(issues);

  const timestamp = now();
  const debt: Debt = {
    id: newId(),
    direction: input.direction,
    counterparty: input.counterparty.trim(),
    principalMinor: input.principalMinor,
    description: input.description?.trim() || null,
    dueDate: input.dueDate || null,
    isWrittenOff: input.isWrittenOff ?? false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return { db: { ...db, debts: [...db.debts, debt] }, debt };
}

export function updateDebt(db: Database, id: string, patch: Partial<DebtInput>): Database {
  if (patch.principalMinor !== undefined && patch.principalMinor <= 0) {
    throw AppError.field('amount', 'The amount must be greater than zero.');
  }
  return {
    ...db,
    debts: replaceById(db.debts, id, (debt) => ({
      ...debt,
      ...(patch.direction !== undefined ? { direction: patch.direction } : {}),
      ...(patch.counterparty !== undefined ? { counterparty: patch.counterparty.trim() } : {}),
      ...(patch.principalMinor !== undefined ? { principalMinor: patch.principalMinor } : {}),
      ...(patch.description !== undefined ? { description: patch.description?.trim() || null } : {}),
      ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate || null } : {}),
      ...(patch.isWrittenOff !== undefined ? { isWrittenOff: patch.isWrittenOff } : {}),
      updatedAt: now(),
    }), 'record'),
  };
}

export function deleteDebt(db: Database, id: string): Database {
  return {
    ...db,
    debts: db.debts.filter((d) => d.id !== id),
    debtPayments: db.debtPayments.filter((p) => p.debtId !== id),
  };
}

export interface RepaymentInput {
  amountMinor: MinorUnits;
  paidOn?: string;
  note?: string | null;
  /** When set, a matching ledger transaction is posted alongside the repayment. */
  accountId?: string;
  categoryId?: string;
  paymentMethod?: PaymentMethod;
}

/**
 * Records a repayment and, optionally, the money actually moving.
 *
 * Both records are produced in one operation so they cannot diverge: either
 * the repayment and its transaction both exist, or neither does.
 */
export function addRepayment(db: Database, debtId: string, input: RepaymentInput): Database {
  const debt = db.debts.find((d) => d.id === debtId);
  if (!debt) throw new AppError('That record no longer exists.');
  if (input.amountMinor <= 0) {
    throw AppError.field('amount', 'A repayment must be greater than zero.');
  }

  const paid = db.debtPayments
    .filter((p) => p.debtId === debtId)
    .reduce((sum, p) => sum + p.amountMinor, 0);
  const outstanding = Math.max(debt.principalMinor - paid, 0);
  if (input.amountMinor > outstanding) {
    throw AppError.field('amount', 'That is more than the amount still outstanding.');
  }

  const paymentId = newId();
  let next = db;
  let transactionId: string | null = null;

  if (input.accountId) {
    if (!input.categoryId) {
      throw AppError.field('categoryId', 'Choose a category for the linked transaction.');
    }
    const created = createTransaction(next, {
      // Paying off "I owe" is an expense; being repaid is income.
      type: debt.direction === 'i_owe' ? 'expense' : 'income',
      amountMinor: input.amountMinor,
      accountId: input.accountId,
      categoryId: input.categoryId,
      description:
        debt.direction === 'i_owe'
          ? `Repayment to ${debt.counterparty}`
          : `Repayment from ${debt.counterparty}`,
      paymentMethod: input.paymentMethod ?? 'other',
      occurredAt: dateKeyToTimestamp(input.paidOn ?? todayKey()),
      source: 'debt',
      debtPaymentId: paymentId,
    });
    next = created.db;
    transactionId = created.transaction.id;
  }

  const payment: DebtPayment = {
    id: paymentId,
    debtId,
    amountMinor: input.amountMinor,
    paidOn: input.paidOn && isValidDateKey(input.paidOn) ? input.paidOn : todayKey(),
    note: input.note?.trim() || null,
    transactionId,
    createdAt: now(),
  };

  return { ...next, debtPayments: [...next.debtPayments, payment] };
}

export function deleteRepayment(db: Database, id: string): Database {
  const payment = db.debtPayments.find((p) => p.id === id);
  if (!payment) throw new AppError('That repayment no longer exists.');
  return {
    ...db,
    debtPayments: db.debtPayments.filter((p) => p.id !== id),
    // The linked transaction goes too — it only existed to mirror this payment.
    transactions: payment.transactionId
      ? db.transactions.filter((t) => t.id !== payment.transactionId)
      : db.transactions,
  };
}

// ── Profile and notifications ───────────────────────────────────────────────

export function updateProfile(db: Database, patch: Partial<Database['profile']>): Database {
  if (patch.name !== undefined && !patch.name.trim()) {
    throw AppError.field('name', 'Enter your name.');
  }
  return {
    ...db,
    profile: {
      ...db.profile,
      ...patch,
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    },
  };
}

export function raiseNotification(
  db: Database,
  input: Omit<AppNotification, 'id' | 'createdAt' | 'readAt'>,
): Database {
  if (input.dedupeKey && db.notifications.some((n) => n.dedupeKey === input.dedupeKey)) {
    return db;
  }
  const notification: AppNotification = {
    ...input,
    id: newId(),
    readAt: null,
    createdAt: now(),
  };
  // Keep the list bounded; nobody scrolls past a hundred alerts.
  const notifications = [notification, ...db.notifications].slice(0, 100);
  return { ...db, notifications };
}

export function markNotificationRead(db: Database, id: string): Database {
  return {
    ...db,
    notifications: db.notifications.map((n) =>
      n.id === id && !n.readAt ? { ...n, readAt: now() } : n),
  };
}

export function markAllNotificationsRead(db: Database): Database {
  const timestamp = now();
  return {
    ...db,
    notifications: db.notifications.map((n) => (n.readAt ? n : { ...n, readAt: timestamp })),
  };
}

export function deleteNotification(db: Database, id: string): Database {
  return { ...db, notifications: db.notifications.filter((n) => n.id !== id) };
}

/** Completes the first-run wizard: opening balance, purpose, optional goal. */
export function completeSetup(
  db: Database,
  input: {
    openingBalanceMinor: MinorUnits;
    accountId?: string;
    moneyPurpose?: Database['profile']['moneyPurpose'];
    name?: string;
    goal?: { name: string; targetMinor: MinorUnits; targetDate?: string | null };
  },
): Database {
  assertMinor(input.openingBalanceMinor, 'Opening balance');

  const target =
    db.accounts.find((a) => a.id === input.accountId) ??
    db.accounts.find((a) => a.isDefault) ??
    db.accounts[0];
  if (!target) throw new AppError('No account to set an opening balance on.');

  let next: Database = {
    ...db,
    accounts: db.accounts.map((account) =>
      account.id === target.id
        ? { ...account, openingBalanceMinor: input.openingBalanceMinor, updatedAt: now() }
        : account),
    profile: {
      ...db.profile,
      ...(input.name?.trim() ? { name: input.name.trim() } : {}),
      ...(input.moneyPurpose ? { moneyPurpose: input.moneyPurpose } : {}),
      setupCompletedAt: db.profile.setupCompletedAt ?? now(),
    },
  };

  if (input.goal) {
    next = createGoal(next, {
      name: input.goal.name,
      targetMinor: input.goal.targetMinor,
      targetDate: input.goal.targetDate ?? null,
    }).db;
  }

  return next;
}

/** Used by the recurring poster; kept here so all writes live in one file. */
export function recordRecurringRun(
  db: Database,
  recurringId: string,
  scheduledFor: string,
  transactionId: string,
  nextRunOn: string | null,
): Database {
  return {
    ...db,
    recurringRuns: [
      ...db.recurringRuns,
      { recurringId, scheduledFor, transactionId, createdAt: now() },
    ],
    recurring: db.recurring.map((rule) =>
      rule.id === recurringId
        ? { ...rule, lastRunOn: scheduledFor, nextRunOn }
        : rule),
  };
}

export { addDays };
