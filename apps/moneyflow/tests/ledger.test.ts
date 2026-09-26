/**
 * Balance derivation and the transaction rules.
 *
 * The property being defended throughout: a balance is a *function* of the
 * transaction list, so no sequence of edits and deletions can make the two
 * disagree.
 */
import { describe, expect, it } from 'vitest';
import type { Database } from '../src/core/types';
import { accountBalances, entriesFor, netWorth, withRunningBalance, transactionViews, byDateAscending } from '../src/core/ledger';
import {
  createAccount, createTransaction, deleteAccount, deleteCategory, deleteTransaction,
  updateTransaction,
} from '../src/core/operations';
import { AT, accountByType, categoryByName, freshDb } from './helpers';

function seeded(): { db: Database; bankId: string; cashId: string } {
  const base = freshDb();
  const bankId = accountByType(base, 'bank');
  const cashId = accountByType(base, 'cash');
  const db: Database = {
    ...base,
    accounts: base.accounts.map((a) =>
      a.id === bankId ? { ...a, openingBalanceMinor: 1_000_000 } : a),
  };
  return { db, bankId, cashId };
}

describe('entriesFor', () => {
  it('gives a transfer two legs that cancel out', () => {
    const { db, bankId, cashId } = seeded();
    const { transaction } = createTransaction(db, {
      type: 'transfer',
      amountMinor: 50_000,
      accountId: bankId,
      toAccountId: cashId,
      description: 'Withdrawal',
    });
    const entries = entriesFor(transaction);
    expect(entries).toHaveLength(2);
    expect(entries.reduce((sum, entry) => sum + entry.deltaMinor, 0)).toBe(0);
  });

  it('treats an adjustment as signed', () => {
    const { db, bankId } = seeded();
    const { transaction } = createTransaction(db, {
      type: 'adjustment',
      amountMinor: -12_345,
      accountId: bankId,
      description: 'Correction',
    });
    expect(entriesFor(transaction)[0]?.deltaMinor).toBe(-12_345);
  });
});

describe('balances survive editing', () => {
  it('cannot double-count an edit', () => {
    const { db, bankId } = seeded();
    const created = createTransaction(db, {
      type: 'expense',
      amountMinor: 100_000,
      accountId: bankId,
      categoryId: categoryByName(db, 'Food'),
      description: 'Groceries',
    });
    expect(accountBalances(created.db).get(bankId)).toBe(900_000);

    // Editing the same transaction ten times must leave one effect, not ten.
    let current = created.db;
    for (let i = 1; i <= 10; i += 1) {
      current = updateTransaction(current, created.transaction.id, { amountMinor: i * 10_000 }).db;
    }
    expect(accountBalances(current).get(bankId)).toBe(1_000_000 - 100_000);
    expect(current.transactions).toHaveLength(1);
  });

  it('leaves no residue after a delete', () => {
    const { db, bankId } = seeded();
    const created = createTransaction(db, {
      type: 'expense',
      amountMinor: 250_000,
      accountId: bankId,
      categoryId: categoryByName(db, 'Food'),
      description: 'Dinner',
    });
    const after = deleteTransaction(created.db, created.transaction.id);
    expect(accountBalances(after).get(bankId)).toBe(1_000_000);
    expect(netWorth(after)).toBe(1_000_000);
  });

  it('re-validates the merged record when a type changes', () => {
    const { db, bankId, cashId } = seeded();
    const created = createTransaction(db, {
      type: 'expense',
      amountMinor: 10_000,
      accountId: bankId,
      categoryId: categoryByName(db, 'Food'),
      description: 'Lunch',
    });
    // Becoming a transfer without a destination is not a valid transaction.
    expect(() => updateTransaction(created.db, created.transaction.id, { type: 'transfer' })).toThrow();
    // With one, it is — and the category is dropped, because transfers have none.
    const changed = updateTransaction(created.db, created.transaction.id, {
      type: 'transfer',
      toAccountId: cashId,
    });
    expect(changed.transaction.categoryId).toBeNull();
    expect(netWorth(changed.db)).toBe(1_000_000);
  });
});

describe('validation', () => {
  it('rejects a zero or negative amount on income and expense', () => {
    const { db, bankId } = seeded();
    for (const amountMinor of [0, -1]) {
      expect(() =>
        createTransaction(db, {
          type: 'expense',
          amountMinor,
          accountId: bankId,
          categoryId: categoryByName(db, 'Food'),
          description: 'Bad',
        })).toThrow();
    }
  });

  it('rejects a transaction against an account that does not exist', () => {
    const { db } = seeded();
    expect(() =>
      createTransaction(db, {
        type: 'income',
        amountMinor: 1000,
        accountId: 'not-a-real-id',
        categoryId: categoryByName(db, 'Salary'),
        description: 'Ghost',
      })).toThrow();
  });
});

describe('deleting the things transactions point at', () => {
  it('refuses to delete an account that has history', () => {
    const { db, bankId } = seeded();
    const withHistory = createTransaction(db, {
      type: 'income',
      amountMinor: 5_000,
      accountId: bankId,
      categoryId: categoryByName(db, 'Salary'),
      description: 'Payment',
    }).db;
    expect(() => deleteAccount(withHistory, bankId)).toThrow();
  });

  it('allows deleting an unused account', () => {
    const { db } = seeded();
    const created = createAccount(db, { name: 'Spare wallet', type: 'wallet', openingBalanceMinor: 0 });
    expect(deleteAccount(created.db, created.account.id).accounts).toHaveLength(db.accounts.length);
  });

  it('reassigns transactions when a category is merged away', () => {
    const { db, bankId } = seeded();
    const food = categoryByName(db, 'Food');
    const groceries = categoryByName(db, 'Groceries');
    const created = createTransaction(db, {
      type: 'expense',
      amountMinor: 20_000,
      accountId: bankId,
      categoryId: food,
      description: 'Lunch',
    });
    const merged = deleteCategory(created.db, food, groceries);
    expect(merged.categories.some((c) => c.id === food)).toBe(false);
    expect(merged.transactions[0]?.categoryId).toBe(groceries);
    // The money did not move.
    expect(netWorth(merged)).toBe(netWorth(created.db));
  });
});

describe('withRunningBalance', () => {
  it('ends at the current net worth', () => {
    const { db, bankId } = seeded();
    let current = db;
    for (const [day, amount] of [['2026-02-01', 30_000], ['2026-02-05', -12_000], ['2026-02-09', 4_500]] as const) {
      current = createTransaction(current, {
        type: amount > 0 ? 'income' : 'expense',
        amountMinor: Math.abs(amount),
        accountId: bankId,
        categoryId: categoryByName(current, amount > 0 ? 'Salary' : 'Food'),
        description: day,
        occurredAt: AT(day),
      }).db;
    }
    const ascending = transactionViews(current, current.transactions.slice().sort(byDateAscending));
    const rows = withRunningBalance(current, ascending);
    expect(rows.at(-1)?.runningBalanceMinor).toBe(netWorth(current));
  });
});
