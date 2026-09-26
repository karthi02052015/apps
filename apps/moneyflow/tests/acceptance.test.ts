/**
 * The acceptance scenario, run against the real engine.
 *
 * This is the specification's own worked example, figure for figure. It is the
 * test that matters most, because it is the one a person could check by hand
 * with a calculator — and every assertion is on integer minor units, so nothing
 * here can pass because of a rounding coincidence.
 *
 *   Opening balance      ₹10,000
 *   Income               ₹50,000 salary + ₹10,000 freelance
 *   Expenses             ₹15,000 rent, ₹5,000 food, ₹3,000 shopping, ₹2,000 electricity
 *   Expected balance     ₹45,000
 *   Edit food to ₹6,000  → ₹44,000
 *   Delete shopping      → ₹47,000
 *   Transfer ₹5,000      → still ₹47,000, split differently
 */
import { describe, expect, it } from 'vitest';
import type { Database } from '../src/core/types';
import { accountBalances, netWorth } from '../src/core/ledger';
import { lifetimeTotals, categoryBreakdown } from '../src/core/analytics';
import { monthBounds } from '../src/core/dates';
import {
  completeSetup, createTransaction, deleteTransaction, updateTransaction,
} from '../src/core/operations';
import { AT, accountByType, categoryByName, freshDb } from './helpers';

const RUPEE = 100; // paise per rupee
const ON = AT('2026-03-15');
const MONTH = monthBounds('2026-03');

describe('section 57 — acceptance scenario', () => {
  // The whole scenario is one arrangement, walked through in order, because
  // each step's expected figure depends on every step before it.
  const base = freshDb();
  const bankId = accountByType(base, 'bank');
  const cashId = accountByType(base, 'cash');
  const category = (name: string) => categoryByName(base, name);

  let db: Database = completeSetup(base, {
    openingBalanceMinor: 10_000 * RUPEE,
    accountId: bankId,
    moneyPurpose: 'personal',
  });

  const created: Record<string, string> = {};

  it('starts with a ₹10,000 opening balance', () => {
    expect(accountBalances(db).get(bankId)).toBe(1_000_000);
    expect(netWorth(db)).toBe(1_000_000);
  });

  it('records income and expenses', () => {
    for (const [description, rupees, categoryName] of [
      ['Salary', 50_000, 'Salary'],
      ['Freelance', 10_000, 'Freelance'],
    ] as const) {
      db = createTransaction(db, {
        type: 'income',
        amountMinor: rupees * RUPEE,
        accountId: bankId,
        categoryId: category(categoryName),
        description,
        paymentMethod: 'bank_transfer',
        occurredAt: ON,
      }).db;
    }

    for (const [description, rupees, categoryName] of [
      ['Rent', 15_000, 'Rent'],
      ['Food', 5_000, 'Food'],
      ['Shopping', 3_000, 'Shopping'],
      ['Electricity', 2_000, 'Electricity'],
    ] as const) {
      const result = createTransaction(db, {
        type: 'expense',
        amountMinor: rupees * RUPEE,
        accountId: bankId,
        categoryId: category(categoryName),
        description,
        paymentMethod: 'upi',
        occurredAt: ON,
      });
      db = result.db;
      created[description] = result.transaction.id;
    }

    const totals = lifetimeTotals(db);
    expect(totals.receivedMinor).toBe(6_000_000); // ₹60,000
    expect(totals.spentMinor).toBe(2_500_000); // ₹25,000
    expect(netWorth(db)).toBe(4_500_000); // ₹45,000
  });

  it('recalculates when an expense is edited', () => {
    db = updateTransaction(db, created.Food as string, { amountMinor: 6_000 * RUPEE }).db;
    expect(netWorth(db)).toBe(4_400_000); // ₹44,000
    expect(lifetimeTotals(db).spentMinor).toBe(2_600_000); // ₹26,000
  });

  it('recalculates when an expense is deleted', () => {
    db = deleteTransaction(db, created.Shopping as string);
    expect(netWorth(db)).toBe(4_700_000); // ₹47,000
    expect(lifetimeTotals(db).spentMinor).toBe(2_300_000); // ₹23,000
  });

  it('moves money on a transfer without creating or destroying any', () => {
    const before = accountBalances(db);
    const bankBefore = before.get(bankId) as number;
    const cashBefore = before.get(cashId) as number;

    db = createTransaction(db, {
      type: 'transfer',
      amountMinor: 5_000 * RUPEE,
      accountId: bankId,
      toAccountId: cashId,
      description: 'Cash withdrawal',
      occurredAt: ON,
    }).db;

    const after = accountBalances(db);
    expect(bankBefore - (after.get(bankId) as number)).toBe(500_000);
    expect((after.get(cashId) as number) - cashBefore).toBe(500_000);

    // The whole point: the total is untouched.
    expect(netWorth(db)).toBe(4_700_000);
    const totals = lifetimeTotals(db);
    expect(totals.receivedMinor).toBe(6_000_000);
    expect(totals.spentMinor).toBe(2_300_000);
  });

  it('leaves the transfer out of the category report', () => {
    const categories = categoryBreakdown(db, MONTH, 'expense', 'Asia/Kolkata');
    expect(categories.some((slice) => slice.name === 'Cash withdrawal')).toBe(false);
    // ₹15,000 rent + ₹6,000 food + ₹2,000 electricity, and nothing else.
    expect(categories.reduce((sum, slice) => sum + slice.amountMinor, 0)).toBe(2_300_000);
  });

  it('ends with exactly the transactions that should exist', () => {
    // 2 income + 4 expenses − 1 deleted + 1 transfer.
    expect(db.transactions).toHaveLength(6);
  });

  it('refuses a negative income', () => {
    expect(() =>
      createTransaction(db, {
        type: 'income',
        amountMinor: -500 * RUPEE,
        accountId: bankId,
        categoryId: category('Salary'),
        description: 'Bad',
      })).toThrow();
  });

  it('refuses a transfer to the same account', () => {
    expect(() =>
      createTransaction(db, {
        type: 'transfer',
        amountMinor: 100 * RUPEE,
        accountId: bankId,
        toAccountId: bankId,
        description: 'Loop',
      })).toThrow();
  });
});
