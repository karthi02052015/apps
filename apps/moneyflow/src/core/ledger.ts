/**
 * The ledger — the heart of the application.
 *
 * Correctness strategy, unchanged from a server-backed design and for the same
 * reasons: **balances are derived, never stored**.
 *
 * A transaction is what the user typed. A `LedgerEntry` is the effect that
 * transaction has on exactly one account, and entries are computed on demand
 * from the transaction itself:
 *
 *     income     →  +amount on accountId
 *     expense    →  −amount on accountId
 *     adjustment →  signed amount on accountId
 *     transfer   →  −amount on accountId, +amount on toAccountId
 *
 * An account balance is therefore always `openingBalance + Σ entries`. Nothing
 * is cached, so nothing can go stale: editing a transaction cannot
 * double-count, deleting one cannot leave a residue, and no code path exists
 * that could produce a balance disagreeing with the transaction list.
 *
 * Transfers produce entries but carry `type: 'transfer'`, and every
 * income/expense aggregate filters on type — which is the whole of "transfers
 * do not count as income or expense".
 */
import type {
  Account, AccountView, Category, CategoryRef, Database, LedgerEntry,
  MinorUnits, Transaction, TransactionType, TransactionView,
} from './types';
import { assertMinor } from './money';

// ── Derivation ──────────────────────────────────────────────────────────────

/** The per-account effects of a single transaction. */
export function entriesFor(transaction: Transaction): LedgerEntry[] {
  const { id, type, amountMinor, accountId, toAccountId, occurredAt } = transaction;
  const base = { transactionId: id, occurredAt };

  switch (type) {
    case 'income':
      return [{ ...base, accountId, deltaMinor: amountMinor, role: 'primary' }];
    case 'expense':
      return [{ ...base, accountId, deltaMinor: -amountMinor, role: 'primary' }];
    case 'adjustment':
      return [{ ...base, accountId, deltaMinor: amountMinor, role: 'primary' }];
    case 'transfer':
      if (!toAccountId) return [];
      return [
        { ...base, accountId, deltaMinor: -amountMinor, role: 'transfer_out' },
        { ...base, accountId: toAccountId, deltaMinor: amountMinor, role: 'transfer_in' },
      ];
    default:
      return [];
  }
}

/** Effect on overall net worth. A transfer moves money; it does not create it. */
export function signedAmount(type: TransactionType, amountMinor: MinorUnits): MinorUnits {
  switch (type) {
    case 'income':
    case 'adjustment':
      return amountMinor;
    case 'expense':
      return -amountMinor;
    default:
      return 0;
  }
}

/** Every ledger entry in the database, unordered. */
export function allEntries(db: Database): LedgerEntry[] {
  return db.transactions.flatMap(entriesFor);
}

// ── Balances ────────────────────────────────────────────────────────────────

/**
 * Current balance of every account, keyed by id.
 *
 * One pass over the transactions rather than one pass per account, so this
 * stays linear no matter how many accounts exist.
 */
export function accountBalances(db: Database): Map<string, MinorUnits> {
  const balances = new Map<string, MinorUnits>();
  for (const account of db.accounts) {
    balances.set(account.id, account.openingBalanceMinor);
  }
  for (const transaction of db.transactions) {
    for (const entry of entriesFor(transaction)) {
      const current = balances.get(entry.accountId);
      if (current === undefined) continue; // account was removed; entry is inert
      balances.set(entry.accountId, current + entry.deltaMinor);
    }
  }
  return balances;
}

/** How many transactions touch each account, counting both legs of a transfer. */
export function accountUsage(db: Database): Map<string, number> {
  const usage = new Map<string, number>();
  const bump = (id: string) => usage.set(id, (usage.get(id) ?? 0) + 1);
  for (const transaction of db.transactions) {
    bump(transaction.accountId);
    if (transaction.toAccountId) bump(transaction.toAccountId);
  }
  return usage;
}

export function accountViews(db: Database, options: { includeArchived?: boolean } = {}): AccountView[] {
  const balances = accountBalances(db);
  const usage = accountUsage(db);
  return db.accounts
    .filter((account) => options.includeArchived || !account.isArchived)
    .slice()
    .sort((a, b) =>
      Number(a.isArchived) - Number(b.isArchived) ||
      a.sortOrder - b.sortOrder ||
      a.createdAt.localeCompare(b.createdAt))
    .map((account) => ({
      ...account,
      currency: db.profile.currency,
      balanceMinor: balances.get(account.id) ?? account.openingBalanceMinor,
      transactionCount: usage.get(account.id) ?? 0,
    }));
}

/** Total money across every account that is not archived. */
export function netWorth(db: Database): MinorUnits {
  let total = 0;
  const balances = accountBalances(db);
  for (const account of db.accounts) {
    if (account.isArchived) continue;
    total += balances.get(account.id) ?? 0;
  }
  return assertMinor(total, 'net worth');
}

/** Net worth as it stood at the end of a given day. */
export function netWorthOn(db: Database, dateKey: string, timeZone?: string): MinorUnits {
  const opening = db.accounts.reduce((sum, account) => sum + account.openingBalanceMinor, 0);
  let movement = 0;
  for (const transaction of db.transactions) {
    const day = toDay(transaction.occurredAt, timeZone);
    if (day > dateKey) continue;
    movement += signedAmount(transaction.type, transaction.amountMinor);
  }
  return opening + movement;
}

function toDay(timestamp: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(timestamp));
}

// ── Views ───────────────────────────────────────────────────────────────────

function toRef(item: Category | Account): CategoryRef {
  return { id: item.id, name: item.name, icon: item.icon, color: item.color };
}

export interface LookupMaps {
  accounts: Map<string, Account>;
  categories: Map<string, Category>;
}

export function buildLookups(db: Database): LookupMaps {
  return {
    accounts: new Map(db.accounts.map((a) => [a.id, a])),
    categories: new Map(db.categories.map((c) => [c.id, c])),
  };
}

const MISSING_ACCOUNT: CategoryRef & { type: Account['type'] } = {
  id: '', name: 'Unknown account', icon: 'wallet', color: 'slate', type: 'other',
};

/** Expands a stored transaction into the shape the UI renders. */
export function toTransactionView(
  transaction: Transaction,
  lookups: LookupMaps,
  currency: string,
): TransactionView {
  const account = lookups.accounts.get(transaction.accountId);
  const toAccount = transaction.toAccountId
    ? lookups.accounts.get(transaction.toAccountId)
    : undefined;
  const category = transaction.categoryId
    ? lookups.categories.get(transaction.categoryId)
    : undefined;

  return {
    ...transaction,
    currency,
    signedAmountMinor: signedAmount(transaction.type, transaction.amountMinor),
    category: category ? toRef(category) : null,
    account: account ? { ...toRef(account), type: account.type } : MISSING_ACCOUNT,
    toAccount: toAccount ? toRef(toAccount) : null,
    isRecurring: transaction.recurringId !== null,
  };
}

export function transactionViews(db: Database, transactions = db.transactions): TransactionView[] {
  const lookups = buildLookups(db);
  return transactions.map((t) => toTransactionView(t, lookups, db.profile.currency));
}

/**
 * Attaches the running net-worth balance after each transaction.
 *
 * The input must be in ascending chronological order; the caller reverses it
 * afterwards if the list is shown newest-first.
 */
export function withRunningBalance(
  db: Database,
  ascending: TransactionView[],
  openingMinor?: MinorUnits,
): TransactionView[] {
  const opening = openingMinor ?? db.accounts.reduce((sum, a) => sum + a.openingBalanceMinor, 0);
  let running = opening;
  // Everything before the first listed transaction still counts towards the
  // balance shown on that row, so it is added up first.
  const listed = new Set(ascending.map((t) => t.id));
  const firstAt = ascending[0]?.occurredAt;
  if (firstAt) {
    for (const transaction of db.transactions) {
      if (listed.has(transaction.id)) continue;
      if (
        transaction.occurredAt < firstAt ||
        (transaction.occurredAt === firstAt && transaction.id < (ascending[0]?.id ?? ''))
      ) {
        running += signedAmount(transaction.type, transaction.amountMinor);
      }
    }
  }
  return ascending.map((view) => {
    running += view.signedAmountMinor;
    return { ...view, runningBalanceMinor: running };
  });
}

/** Chronological comparator used everywhere a list is ordered by date. */
export function byDateAscending(a: Transaction, b: Transaction): number {
  return a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id);
}

export function byDateDescending(a: Transaction, b: Transaction): number {
  return -byDateAscending(a, b);
}
