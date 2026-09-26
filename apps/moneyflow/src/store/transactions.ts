/**
 * Filtering, sorting and paging the transaction list.
 *
 * On a server this was a SQL query; here it is one pass over an array, which
 * is fast enough for the sizes a personal tracker reaches (tens of thousands
 * of rows at most) and has the advantage of being exactly consistent with
 * every other view, because it reads the same object.
 *
 * The returned `meta` mirrors what the paged API used to send, so the list
 * page's paging controls and its "net for this selection" figure work
 * unchanged.
 */
import type { Database, MinorUnits, TransactionType, TransactionView } from '../core/types';
import { LOCAL_TIMEZONE, toDateKey } from '../core/dates';
import { byDateAscending, signedAmount, transactionViews, withRunningBalance } from '../core/ledger';
import { parseAmountToMinor } from '../core/money';

export interface TransactionFilters {
  q?: string;
  type?: TransactionType[];
  categoryId?: string[];
  accountId?: string[];
  paymentMethod?: string[];
  from?: string;
  to?: string;
  minAmount?: string;
  maxAmount?: string;
  sort?: 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';
  page?: number;
  pageSize?: number;
  withRunningBalance?: boolean;
}

export interface TransactionsPage {
  items: TransactionView[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    /** Net effect on net worth of *everything matching*, not just this page. */
    netAmountMinor: MinorUnits;
    incomeMinor: MinorUnits;
    expenseMinor: MinorUnits;
  };
}

const DEFAULT_PAGE_SIZE = 25;

/** A tolerant amount parse: a filter box should not throw on "1,2". */
function optionalMinor(value: string | undefined, currency: string): MinorUnits | null {
  if (!value?.trim()) return null;
  try {
    return parseAmountToMinor(value, currency);
  } catch {
    return null;
  }
}

export function queryTransactions(db: Database, filters: TransactionFilters = {}): TransactionsPage {
  const timeZone = LOCAL_TIMEZONE;
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE));
  const currency = db.profile.currency;

  const needle = filters.q?.trim().toLowerCase();
  const types = filters.type?.length ? new Set(filters.type) : null;
  const categories = filters.categoryId?.length ? new Set(filters.categoryId) : null;
  const accounts = filters.accountId?.length ? new Set(filters.accountId) : null;
  const methods = filters.paymentMethod?.length ? new Set(filters.paymentMethod) : null;
  const min = optionalMinor(filters.minAmount, currency);
  const max = optionalMinor(filters.maxAmount, currency);

  const matched = db.transactions.filter((transaction) => {
    if (types && !types.has(transaction.type)) return false;
    if (categories && !(transaction.categoryId && categories.has(transaction.categoryId))) return false;
    // A transfer matches either side, which is what a user filtering by
    // account expects to see.
    if (
      accounts &&
      !accounts.has(transaction.accountId) &&
      !(transaction.toAccountId && accounts.has(transaction.toAccountId))
    ) {
      return false;
    }
    if (methods && !methods.has(transaction.paymentMethod)) return false;
    if (min !== null && transaction.amountMinor < min) return false;
    if (max !== null && transaction.amountMinor > max) return false;

    if (filters.from || filters.to) {
      const day = toDateKey(transaction.occurredAt, timeZone);
      if (filters.from && day < filters.from) return false;
      if (filters.to && day > filters.to) return false;
    }

    if (needle) {
      const haystack = `${transaction.description} ${transaction.notes ?? ''}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });

  let incomeMinor = 0;
  let expenseMinor = 0;
  let netAmountMinor = 0;
  for (const transaction of matched) {
    if (transaction.type === 'income') incomeMinor += transaction.amountMinor;
    else if (transaction.type === 'expense') expenseMinor += transaction.amountMinor;
    netAmountMinor += signedAmount(transaction.type, transaction.amountMinor);
  }

  const sorted = matched.slice();
  switch (filters.sort ?? 'date_desc') {
    case 'date_asc':
      sorted.sort(byDateAscending);
      break;
    case 'amount_desc':
      sorted.sort((a, b) => b.amountMinor - a.amountMinor || byDateAscending(b, a));
      break;
    case 'amount_asc':
      sorted.sort((a, b) => a.amountMinor - b.amountMinor || byDateAscending(a, b));
      break;
    default:
      sorted.sort((a, b) => -byDateAscending(a, b));
  }

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (Math.min(page, totalPages) - 1) * pageSize;
  const slice = sorted.slice(start, start + pageSize);

  let items = transactionViews(db, slice);
  // A running balance only means anything on a chronological list, so it is
  // computed ascending and flipped back if the user is looking newest-first.
  if (filters.withRunningBalance && (filters.sort ?? 'date_desc').startsWith('date')) {
    const ascending = filters.sort === 'date_asc' ? items : items.slice().reverse();
    const withBalance = withRunningBalance(db, ascending);
    items = filters.sort === 'date_asc' ? withBalance : withBalance.slice().reverse();
  }

  return {
    items,
    meta: {
      page: Math.min(page, totalPages),
      pageSize,
      total,
      totalPages,
      netAmountMinor,
      incomeMinor,
      expenseMinor,
    },
  };
}

/** Categories the user reaches for most, for the quick-add buttons. */
export function frequentCategories(db: Database, kind: 'income' | 'expense', limit = 6): string[] {
  const counts = new Map<string, number>();
  // Only the recent past: what someone used last year is not a shortcut today.
  const recent = db.transactions.slice(-400);
  for (const transaction of recent) {
    if (transaction.type !== kind || !transaction.categoryId) continue;
    counts.set(transaction.categoryId, (counts.get(transaction.categoryId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);
}
