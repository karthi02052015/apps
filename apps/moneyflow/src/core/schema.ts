/**
 * The database's shape, its version, and how an older one is brought forward.
 *
 * A browser-only app has the same migration problem a server one does, just
 * moved: the data sitting in IndexedDB was written by whatever version of
 * MoneyFlow the user last had open, and a deployed update must read it without
 * losing anything. So the stored object carries a `schemaVersion`, every change
 * to the shape adds a migration step, and `migrate()` runs the steps in order.
 *
 * `parseDatabase()` is the other half: it is the boundary where untrusted data
 * — a restored backup, a hand-edited export, a half-written record — becomes a
 * `Database` the rest of the app can assume is well-formed. Nothing else in
 * the codebase does defensive checks, because everything else is downstream of
 * this function.
 */
import type {
  Account, AppNotification, Budget, Category, Database, Debt, DebtPayment, Goal,
  GoalContribution, Profile, Recurring, RecurringRun, Transaction,
} from './types';
import { MONEY_PURPOSES, type MoneyPurpose } from './types';
import { isSupportedCurrency } from './money';
import { newId } from './operations';
import { DEFAULT_ACCOUNTS, DEFAULT_CATEGORIES } from './defaults';

/** Bump this — and add a step to MIGRATIONS — whenever the shape changes. */
export const CURRENT_SCHEMA_VERSION = 1;

const now = (): string => new Date().toISOString();

export function defaultProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    name: '',
    currency: 'INR',
    theme: 'system',
    moneyPurpose: null,
    setupCompletedAt: null,
    notificationPrefs: {
      budgetAlerts: true,
      recurringReminders: true,
      debtReminders: true,
      goalMilestones: true,
      largeExpenses: true,
    },
    // ₹5,000. Deliberately a round number the user can see and change.
    largeExpenseThresholdMinor: 500_000,
    createdAt: now(),
    ...overrides,
  };
}

/**
 * A brand-new database: the starter accounts and categories, nothing else.
 *
 * The seeds become *real, editable rows owned by the user* rather than global
 * system records, so renaming "Food" to "Eating out" needs no special case
 * anywhere. `isSystem` only marks where a row came from, which the UI uses to
 * warn before deleting one.
 */
export function emptyDatabase(profile: Partial<Profile> = {}): Database {
  const timestamp = now();

  const accounts: Account[] = DEFAULT_ACCOUNTS.map((seed, index) => ({
    id: newId(),
    name: seed.name,
    type: seed.type,
    institution: null,
    color: seed.color,
    icon: seed.icon,
    openingBalanceMinor: 0,
    isDefault: seed.isDefault ?? false,
    isArchived: false,
    sortOrder: index,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));

  const categories: Category[] = DEFAULT_CATEGORIES.map((seed, index) => ({
    id: newId(),
    name: seed.name,
    kind: seed.kind,
    icon: seed.icon,
    color: seed.color,
    isSystem: true,
    isArchived: false,
    sortOrder: index,
  }));

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    profile: defaultProfile(profile),
    accounts,
    categories,
    transactions: [],
    budgets: [],
    goals: [],
    goalContributions: [],
    recurring: [],
    recurringRuns: [],
    debts: [],
    debtPayments: [],
    notifications: [],
  };
}

// ── Migrations ──────────────────────────────────────────────────────────────

type Migration = (db: Record<string, unknown>) => Record<string, unknown>;

/**
 * One entry per version step: `MIGRATIONS[n]` upgrades a database at version
 * `n` to version `n + 1`. Version 0 is "written before versioning existed".
 */
const MIGRATIONS: Record<number, Migration> = {
  0: (db) => ({ ...db, schemaVersion: 1 }),
};

export function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  let db = raw;
  let version = typeof db.schemaVersion === 'number' ? db.schemaVersion : 0;

  while (version < CURRENT_SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) break; // No path forward; `parseDatabase` salvages what it can.
    db = step(db);
    version = typeof db.schemaVersion === 'number' ? db.schemaVersion : version + 1;
  }

  // Data written by a *newer* build than the one now running. Refusing would
  // strand the user; the field-level parse below drops anything unreadable.
  return { ...db, schemaVersion: CURRENT_SCHEMA_VERSION };
}

// ── Parsing ─────────────────────────────────────────────────────────────────

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const nullableStr = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const bool = (v: unknown, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback);
const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/** Money must be a whole number of minor units; a float here is corrupt data. */
const minor = (v: unknown, fallback = 0): number => {
  const value = num(v, fallback);
  return Number.isSafeInteger(value) ? value : Math.round(value);
};

function parseArray<T>(value: unknown, parse: (item: Record<string, unknown>) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const item of value) {
    if (!isObject(item)) continue;
    const parsed = parse(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

const ONE_OF = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

const ACCOUNT_TYPES = ['cash', 'bank', 'wallet', 'credit_card', 'savings', 'investment', 'other'] as const;
const TRANSACTION_TYPES = ['income', 'expense', 'transfer', 'adjustment'] as const;
const PAYMENT_METHODS = [
  'cash', 'upi', 'debit_card', 'credit_card', 'bank_transfer', 'netbanking', 'cheque',
  'auto_debit', 'other',
] as const;
const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
const SOURCES = ['manual', 'recurring', 'debt', 'import', 'sample'] as const;

function parseProfile(value: unknown): Profile {
  if (!isObject(value)) return defaultProfile();
  const base = defaultProfile();
  const currency = str(value.currency, base.currency);
  return {
    name: str(value.name, base.name),
    currency: isSupportedCurrency(currency) ? currency : base.currency,
    theme: ONE_OF(value.theme, ['light', 'dark', 'system'] as const, base.theme),
    moneyPurpose: MONEY_PURPOSES.includes(value.moneyPurpose as MoneyPurpose)
      ? (value.moneyPurpose as MoneyPurpose)
      : null,
    setupCompletedAt: nullableStr(value.setupCompletedAt),
    notificationPrefs: isObject(value.notificationPrefs)
      ? { ...base.notificationPrefs, ...(value.notificationPrefs as Record<string, boolean>) }
      : base.notificationPrefs,
    largeExpenseThresholdMinor: minor(
      value.largeExpenseThresholdMinor,
      base.largeExpenseThresholdMinor,
    ),
    createdAt: str(value.createdAt, base.createdAt),
  };
}

/**
 * Turns whatever was in storage into a `Database`.
 *
 * Records that cannot be read are dropped rather than throwing: losing one
 * malformed transaction is better than refusing to open the app. Referential
 * integrity is repaired at the end — a transaction pointing at an account that
 * no longer exists would otherwise render as "Unknown account" forever.
 */
export function parseDatabase(raw: unknown): Database {
  if (!isObject(raw)) return emptyDatabase();
  const source = migrate(raw);
  const fallback = emptyDatabase();

  const accounts = parseArray<Account>(source.accounts, (a) =>
    typeof a.id === 'string'
      ? {
          id: a.id,
          name: str(a.name, 'Account'),
          type: ONE_OF(a.type, ACCOUNT_TYPES, 'other'),
          institution: nullableStr(a.institution),
          color: str(a.color, 'slate'),
          icon: str(a.icon, 'wallet'),
          openingBalanceMinor: minor(a.openingBalanceMinor),
          isDefault: bool(a.isDefault),
          isArchived: bool(a.isArchived),
          sortOrder: num(a.sortOrder),
          createdAt: str(a.createdAt, fallback.profile.createdAt),
          updatedAt: str(a.updatedAt, fallback.profile.createdAt),
        }
      : null);

  const categories = parseArray<Category>(source.categories, (c) =>
    typeof c.id === 'string'
      ? {
          id: c.id,
          name: str(c.name, 'Category'),
          kind: ONE_OF(c.kind, ['income', 'expense'] as const, 'expense'),
          icon: str(c.icon, 'tag'),
          color: str(c.color, 'slate'),
          isSystem: bool(c.isSystem),
          isArchived: bool(c.isArchived),
          sortOrder: num(c.sortOrder),
        }
      : null);

  const accountIds = new Set(accounts.map((a) => a.id));
  const categoryIds = new Set(categories.map((c) => c.id));

  const transactions = parseArray<Transaction>(source.transactions, (t) => {
    if (typeof t.id !== 'string' || typeof t.accountId !== 'string') return null;
    if (!accountIds.has(t.accountId)) return null; // orphan: its account is gone
    const type = ONE_OF(t.type, TRANSACTION_TYPES, 'expense');
    const amountMinor = minor(t.amountMinor);
    if (amountMinor === 0 && type !== 'adjustment') return null;
    const toAccountId = nullableStr(t.toAccountId);
    if (type === 'transfer' && (!toAccountId || !accountIds.has(toAccountId))) return null;
    const categoryId = nullableStr(t.categoryId);
    return {
      id: t.id,
      type,
      amountMinor,
      accountId: t.accountId,
      toAccountId: type === 'transfer' ? toAccountId : null,
      categoryId: categoryId && categoryIds.has(categoryId) ? categoryId : null,
      description: str(t.description, 'Transaction'),
      notes: nullableStr(t.notes),
      paymentMethod: ONE_OF(t.paymentMethod, PAYMENT_METHODS, 'other'),
      occurredAt: str(t.occurredAt, fallback.profile.createdAt),
      isSample: bool(t.isSample),
      source: ONE_OF(t.source, SOURCES, 'manual'),
      recurringId: nullableStr(t.recurringId),
      debtPaymentId: nullableStr(t.debtPaymentId),
      createdAt: str(t.createdAt, fallback.profile.createdAt),
      updatedAt: str(t.updatedAt, fallback.profile.createdAt),
    };
  });

  const budgets = parseArray<Budget>(source.budgets, (b) =>
    typeof b.id === 'string'
      ? {
          id: b.id,
          name: str(b.name, 'Budget'),
          period: ONE_OF(b.period, ['weekly', 'monthly', 'yearly'] as const, 'monthly'),
          limitMinor: minor(b.limitMinor),
          categoryIds: Array.isArray(b.categoryIds)
            ? b.categoryIds.filter((id): id is string => typeof id === 'string' && categoryIds.has(id))
            : [],
          alertThresholdPct: Math.min(100, Math.max(1, num(b.alertThresholdPct, 80))),
          color: str(b.color, 'indigo'),
          isActive: bool(b.isActive, true),
          createdAt: str(b.createdAt, fallback.profile.createdAt),
        }
      : null);

  const goals = parseArray<Goal>(source.goals, (g) =>
    typeof g.id === 'string'
      ? {
          id: g.id,
          name: str(g.name, 'Goal'),
          description: nullableStr(g.description),
          targetMinor: minor(g.targetMinor),
          targetDate: nullableStr(g.targetDate),
          color: str(g.color, 'indigo'),
          icon: str(g.icon, 'target'),
          status: ONE_OF(g.status, ['active', 'achieved', 'archived'] as const, 'active'),
          createdAt: str(g.createdAt, fallback.profile.createdAt),
        }
      : null);
  const goalIds = new Set(goals.map((g) => g.id));

  const goalContributions = parseArray<GoalContribution>(source.goalContributions, (c) =>
    typeof c.id === 'string' && typeof c.goalId === 'string' && goalIds.has(c.goalId)
      ? {
          id: c.id,
          goalId: c.goalId,
          amountMinor: minor(c.amountMinor),
          occurredOn: str(c.occurredOn, fallback.profile.createdAt.slice(0, 10)),
          note: nullableStr(c.note),
          createdAt: str(c.createdAt, fallback.profile.createdAt),
        }
      : null);

  const recurring = parseArray<Recurring>(source.recurring, (r) => {
    if (typeof r.id !== 'string' || typeof r.accountId !== 'string') return null;
    if (!accountIds.has(r.accountId)) return null;
    const type = ONE_OF(r.type, ['income', 'expense', 'transfer'] as const, 'expense');
    const toAccountId = nullableStr(r.toAccountId);
    return {
      id: r.id,
      type,
      amountMinor: minor(r.amountMinor),
      accountId: r.accountId,
      toAccountId: type === 'transfer' && toAccountId && accountIds.has(toAccountId) ? toAccountId : null,
      categoryId: (() => {
        const id = nullableStr(r.categoryId);
        return id && categoryIds.has(id) ? id : null;
      })(),
      description: str(r.description, 'Recurring'),
      notes: nullableStr(r.notes),
      paymentMethod: ONE_OF(r.paymentMethod, PAYMENT_METHODS, 'other'),
      frequency: ONE_OF(r.frequency, FREQUENCIES, 'monthly'),
      intervalCount: Math.min(52, Math.max(1, num(r.intervalCount, 1))),
      startDate: str(r.startDate, fallback.profile.createdAt.slice(0, 10)),
      endDate: nullableStr(r.endDate),
      nextRunOn: nullableStr(r.nextRunOn),
      lastRunOn: nullableStr(r.lastRunOn),
      isSubscription: bool(r.isSubscription),
      merchant: nullableStr(r.merchant),
      autoPost: bool(r.autoPost, true),
      isActive: bool(r.isActive, true),
      createdAt: str(r.createdAt, fallback.profile.createdAt),
    };
  });
  const recurringIds = new Set(recurring.map((r) => r.id));

  const recurringRuns = parseArray<RecurringRun>(source.recurringRuns, (run) =>
    typeof run.recurringId === 'string' &&
    typeof run.scheduledFor === 'string' &&
    recurringIds.has(run.recurringId)
      ? {
          recurringId: run.recurringId,
          scheduledFor: run.scheduledFor,
          transactionId: str(run.transactionId),
          createdAt: str(run.createdAt, fallback.profile.createdAt),
        }
      : null);

  const debts = parseArray<Debt>(source.debts, (d) =>
    typeof d.id === 'string'
      ? {
          id: d.id,
          direction: ONE_OF(d.direction, ['i_owe', 'owed_to_me'] as const, 'i_owe'),
          counterparty: str(d.counterparty, 'Someone'),
          principalMinor: minor(d.principalMinor),
          description: nullableStr(d.description),
          dueDate: nullableStr(d.dueDate),
          isWrittenOff: bool(d.isWrittenOff),
          createdAt: str(d.createdAt, fallback.profile.createdAt),
          updatedAt: str(d.updatedAt, fallback.profile.createdAt),
        }
      : null);
  const debtIds = new Set(debts.map((d) => d.id));

  const debtPayments = parseArray<DebtPayment>(source.debtPayments, (p) =>
    typeof p.id === 'string' && typeof p.debtId === 'string' && debtIds.has(p.debtId)
      ? {
          id: p.id,
          debtId: p.debtId,
          amountMinor: minor(p.amountMinor),
          paidOn: str(p.paidOn, fallback.profile.createdAt.slice(0, 10)),
          note: nullableStr(p.note),
          transactionId: nullableStr(p.transactionId),
          createdAt: str(p.createdAt, fallback.profile.createdAt),
        }
      : null);

  const notifications = parseArray<AppNotification>(source.notifications, (n) =>
    typeof n.id === 'string'
      ? {
          id: n.id,
          type: ONE_OF(
            n.type,
            [
              'budget_warning', 'budget_exceeded', 'recurring_due', 'debt_due',
              'goal_milestone', 'goal_achieved', 'large_expense', 'system',
            ] as const,
            'system',
          ),
          severity: ONE_OF(n.severity, ['info', 'warning', 'critical', 'success'] as const, 'info'),
          title: str(n.title, 'Notification'),
          body: str(n.body),
          payload: isObject(n.payload) ? n.payload : {},
          dedupeKey: nullableStr(n.dedupeKey),
          readAt: nullableStr(n.readAt),
          createdAt: str(n.createdAt, fallback.profile.createdAt),
        }
      : null);

  // A database with no accounts cannot record anything, so a restore that lost
  // them falls back to the starter set rather than leaving a dead-end UI.
  if (accounts.length === 0) return { ...emptyDatabase(), profile: parseProfile(source.profile) };

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    profile: parseProfile(source.profile),
    accounts,
    categories: categories.length > 0 ? categories : fallback.categories,
    transactions,
    budgets,
    goals,
    goalContributions,
    recurring,
    recurringRuns,
    debts,
    debtPayments,
    notifications,
  };
}

/** The export format: the database plus provenance, for a readable backup. */
export interface BackupFile {
  application: 'moneyflow';
  schemaVersion: number;
  exportedAt: string;
  data: Database;
}

export function toBackup(db: Database): BackupFile {
  return {
    application: 'moneyflow',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: now(),
    data: db,
  };
}

/** Accepts either a backup envelope or a bare database, for hand-edited files. */
export function fromBackup(raw: unknown): Database {
  if (isObject(raw) && isObject(raw.data)) return parseDatabase(raw.data);
  return parseDatabase(raw);
}
