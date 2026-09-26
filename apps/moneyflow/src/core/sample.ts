/**
 * Sample data.
 *
 * An empty money tracker is a hard thing to evaluate — every chart is blank
 * and every page says "nothing here yet". This generates three months of
 * plausible activity so a new user can see what the app actually does before
 * typing a single number of their own.
 *
 * Every row it creates is marked `isSample`, so `clearSampleTransactions`
 * removes them cleanly and no sample figure can survive into real data.
 */
import type { Database, DateKey, MinorUnits } from './types';
import { addDays, dateKeyToTimestamp, todayKey, LOCAL_TIMEZONE, monthBounds, shiftMonth } from './dates';
import {
  addGoalContribution, createBudget, createGoal, createRecurring, createTransaction,
} from './operations';

/**
 * A tiny deterministic generator, so the same seed always produces the same
 * data — a demo that looks different on every reload is impossible to talk
 * about, and a test over random data cannot assert anything.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

interface Spend {
  category: string;
  description: string[];
  /** Inclusive range in minor units. */
  min: MinorUnits;
  max: MinorUnits;
  /** Roughly how many times a month. */
  perMonth: number;
  method: 'upi' | 'cash' | 'debit_card' | 'credit_card' | 'auto_debit' | 'netbanking';
}

const SPENDS: Spend[] = [
  { category: 'Groceries', description: ['Weekly groceries', 'Supermarket run', 'Vegetables'], min: 45_000, max: 220_000, perMonth: 5, method: 'upi' },
  { category: 'Food', description: ['Lunch out', 'Coffee', 'Dinner with friends', 'Takeaway'], min: 12_000, max: 140_000, perMonth: 8, method: 'upi' },
  { category: 'Fuel', description: ['Petrol', 'Fuel top-up'], min: 60_000, max: 250_000, perMonth: 3, method: 'debit_card' },
  { category: 'Shopping', description: ['Clothes', 'Household items', 'Online order'], min: 80_000, max: 600_000, perMonth: 2, method: 'credit_card' },
  { category: 'Entertainment', description: ['Cinema', 'Concert tickets', 'Weekend outing'], min: 30_000, max: 250_000, perMonth: 2, method: 'upi' },
  { category: 'Personal Care', description: ['Haircut', 'Pharmacy', 'Gym'], min: 20_000, max: 180_000, perMonth: 2, method: 'cash' },
  { category: 'Travel', description: ['Cab', 'Train ticket', 'Bus pass'], min: 15_000, max: 320_000, perMonth: 3, method: 'upi' },
];

/** Bills that land on the same day each month, near enough. */
const BILLS: { category: string; description: string; amount: MinorUnits; day: number }[] = [
  { category: 'Rent', description: 'Monthly rent', amount: 1_800_000, day: 3 },
  { category: 'Electricity', description: 'Electricity bill', amount: 210_000, day: 9 },
  { category: 'Internet', description: 'Broadband', amount: 99_900, day: 12 },
  { category: 'Mobile', description: 'Mobile recharge', amount: 39_900, day: 15 },
];

const SALARY_MINOR = 8_500_000; // ₹85,000
const SALARY_DAY = 1;

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T;
}

/** A round-ish amount inside a range — real spending is rarely to the paisa. */
function amountBetween(random: () => number, min: MinorUnits, max: MinorUnits): MinorUnits {
  const raw = min + Math.floor(random() * (max - min));
  return Math.round(raw / 1000) * 1000;
}

export interface SampleOptions {
  months?: number;
  seed?: number;
  today?: DateKey;
  timeZone?: string;
}

/**
 * Adds sample transactions, a budget, a goal and a subscription to an existing
 * database. The caller's accounts and categories are used as they are, so the
 * sample fits whatever the user has already set up.
 */
export function withSampleData(db: Database, options: SampleOptions = {}): Database {
  const { months = 3, seed = 20_260_101 } = options;
  const today = options.today ?? todayKey(options.timeZone ?? LOCAL_TIMEZONE);
  const random = mulberry32(seed);

  const categoryByName = new Map(db.categories.map((c) => [c.name, c.id]));
  const bank = db.accounts.find((a) => a.type === 'bank') ?? db.accounts[0];
  const cash = db.accounts.find((a) => a.type === 'cash') ?? bank;
  if (!bank || !cash) return db;

  let next: Database = {
    ...db,
    // Opening balances give the balance chart somewhere to start, and keep the
    // cash account from going negative before its first top-up.
    accounts: db.accounts.map((account) => {
      if (account.openingBalanceMinor !== 0) return account;
      if (account.id === bank.id) return { ...account, openingBalanceMinor: 2_500_000 };
      if (account.id === cash.id) return { ...account, openingBalanceMinor: 400_000 };
      return account;
    }),
  };

  const add = (
    type: 'income' | 'expense',
    categoryName: string,
    description: string,
    amountMinor: MinorUnits,
    date: DateKey,
    method: string,
  ): void => {
    const categoryId = categoryByName.get(categoryName);
    if (!categoryId || date > today) return;
    next = createTransaction(next, {
      type,
      amountMinor,
      accountId: method === 'cash' ? cash.id : bank.id,
      categoryId,
      description,
      paymentMethod: method as never,
      occurredAt: dateKeyToTimestamp(date),
      isSample: true,
      source: 'sample',
    }).db;
  };

  for (let back = months - 1; back >= 0; back -= 1) {
    const month = shiftMonth(today.slice(0, 7), -back);
    const { to } = monthBounds(month);
    const dayOf = (day: number): DateKey => {
      const candidate = `${month}-${String(day).padStart(2, '0')}`;
      return candidate > to ? to : candidate;
    };

    add('income', 'Salary', 'Monthly salary', SALARY_MINOR, dayOf(SALARY_DAY), 'bank_transfer');

    // A monthly cash withdrawal, so the cash account funds its own spending —
    // and so the sample has a transfer in it, which is the case most worth
    // seeing work.
    const withdrawalOn = dayOf(2);
    if (withdrawalOn <= today) {
      next = createTransaction(next, {
        type: 'transfer',
        amountMinor: 800_000,
        accountId: bank.id,
        toAccountId: cash.id,
        description: 'Cash withdrawal',
        paymentMethod: 'bank_transfer',
        occurredAt: dateKeyToTimestamp(withdrawalOn),
        isSample: true,
        source: 'sample',
      }).db;
    }

    for (const bill of BILLS) {
      add('expense', bill.category, bill.description, bill.amount, dayOf(bill.day), 'auto_debit');
    }

    for (const spend of SPENDS) {
      // Vary the count a little so months are not carbon copies.
      const count = Math.max(1, spend.perMonth + Math.round(random() * 2 - 1));
      for (let i = 0; i < count; i += 1) {
        const day = 1 + Math.floor(random() * 28);
        add(
          'expense',
          spend.category,
          pick(random, spend.description),
          amountBetween(random, spend.min, spend.max),
          dayOf(day),
          spend.method,
        );
      }
    }

    // An occasional bit of side income, so the income chart is not a flat line.
    if (random() > 0.5) {
      add('income', 'Freelance', 'Freelance project', amountBetween(random, 800_000, 2_500_000), dayOf(20), 'bank_transfer');
    }
  }

  // A budget over the everyday categories, sized to be interesting: usually
  // close to the limit, sometimes over it.
  const budgetCategories = ['Food', 'Groceries', 'Entertainment', 'Shopping']
    .map((name) => categoryByName.get(name))
    .filter((id): id is string => Boolean(id));
  if (budgetCategories.length > 0) {
    next = createBudget(next, {
      name: 'Everyday spending',
      period: 'monthly',
      limitMinor: 2_000_000,
      categoryIds: budgetCategories,
      alertThresholdPct: 80,
      color: 'indigo',
    }).db;
  }

  const goal = createGoal(next, {
    name: 'Emergency fund',
    description: 'Three months of expenses, set aside.',
    targetMinor: 15_000_000,
    targetDate: addDays(today, 240),
    icon: 'shield-check',
    color: 'emerald',
  });
  next = goal.db;
  for (let back = months - 1; back >= 0; back -= 1) {
    next = addGoalContribution(next, goal.goal.id, {
      amountMinor: 1_500_000,
      occurredOn: `${shiftMonth(today.slice(0, 7), -back)}-05`,
      note: 'Monthly transfer',
    });
  }

  const subscriptionCategory = categoryByName.get('Subscriptions');
  if (subscriptionCategory) {
    next = createRecurring(next, {
      type: 'expense',
      amountMinor: 64_900,
      accountId: bank.id,
      categoryId: subscriptionCategory,
      description: 'Streaming subscription',
      paymentMethod: 'auto_debit',
      frequency: 'monthly',
      startDate: `${shiftMonth(today.slice(0, 7), -months + 1)}-18`,
      isSubscription: true,
      merchant: 'Streaming service',
      autoPost: false,
    }).db;
  }

  return next;
}

/** A complete sample database, used by the tests and the demo mode. */
export function sampleDatabase(base: Database, options: SampleOptions = {}): Database {
  const seeded = withSampleData(base, options);
  return {
    ...seeded,
    profile: { ...seeded.profile, setupCompletedAt: seeded.profile.setupCompletedAt ?? new Date().toISOString() },
  };
}
