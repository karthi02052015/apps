/**
 * Smart insights.
 *
 * Deliberately *rule-based*, not predictive, and deliberately not advice. Each
 * insight is a statement about numbers the user has already recorded, and each
 * one ships with the figures it was derived from so the UI can show its work.
 *
 * Nothing here recommends a financial action; the wording stays observational
 * ("you spent more on food than last month"), which is what keeps the feature
 * honest — the app has no idea what the user should do with their money.
 *
 * Every rule follows the same contract: look at the context, return an insight
 * or `null`. Adding a rule means adding one function to `RULES`.
 */
import type { CategorySlice, Database, MinorUnits, MonthKey, PeriodTotals } from './types';
import { ratioBps } from './money';
import { LOCAL_TIMEZONE, monthBounds, shiftMonth, todayKey } from './dates';
import { categoryBreakdown, periodTotals } from './analytics';
import { subscriptionSummary } from './recurring';
import { goalViews } from './goals';
import { debtTotals } from './debts';
import { toDateKey } from './dates';

export interface Insight {
  id: string;
  kind: 'comparison' | 'composition' | 'milestone' | 'pattern' | 'attention';
  tone: 'positive' | 'neutral' | 'caution';
  icon: string;
  title: string;
  /** Contains `{{placeholders}}` the UI fills from `facts`, formatted as money. */
  detail: string;
  facts: Record<string, number | string | null>;
}

interface InsightContext {
  month: MonthKey;
  previousMonth: MonthKey;
  totals: PeriodTotals;
  previousTotals: PeriodTotals;
  categories: CategorySlice[];
  previousCategories: CategorySlice[];
  subscriptionMonthlyMinor: MinorUnits;
  subscriptionCount: number;
  goalProgress: { name: string; progressBps: number; savedMinor: MinorUnits }[];
  daysWithSpending: number;
  daysElapsed: number;
  biggestSingleExpense: { description: string; amountMinor: MinorUnits } | null;
  outstandingDebtMinor: MinorUnits;
}

type Rule = (ctx: InsightContext) => Insight | null;

/** Movements smaller than this are noise, not news. */
const MATERIAL_DELTA_MINOR = 50_000;

const RULES: Rule[] = [
  // Month-over-month movement in the largest category.
  (ctx) => {
    const top = ctx.categories[0];
    if (!top || ctx.previousTotals.expenseMinor === 0) return null;
    const previous = ctx.previousCategories.find((c) => c.categoryId === top.categoryId);
    if (!previous) return null;
    const delta = top.amountMinor - previous.amountMinor;
    if (Math.abs(delta) < MATERIAL_DELTA_MINOR) return null;
    return {
      id: `category-change:${top.categoryId}`,
      kind: 'comparison',
      tone: delta > 0 ? 'caution' : 'positive',
      icon: delta > 0 ? 'trending-up' : 'trending-down',
      title: `${top.name} ${delta > 0 ? 'is up' : 'is down'} this month`,
      detail:
        `You have recorded {{delta}} ${delta > 0 ? 'more' : 'less'} on ${top.name} ` +
        `than in ${ctx.previousMonth}.`,
      facts: {
        deltaMinor: Math.abs(delta),
        thisMonthMinor: top.amountMinor,
        lastMonthMinor: previous.amountMinor,
        category: top.name,
      },
    };
  },

  // Where the money actually went.
  (ctx) => {
    const top = ctx.categories[0];
    if (!top || top.shareBps < 1500) return null;
    return {
      id: `top-category:${top.categoryId}`,
      kind: 'composition',
      tone: 'neutral',
      icon: 'pie-chart',
      title: `${top.name} is your largest spending category`,
      detail: 'It accounts for {{share}} of what you spent this month.',
      facts: {
        shareBps: top.shareBps,
        amountMinor: top.amountMinor,
        category: top.name,
        transactionCount: top.transactionCount,
      },
    };
  },

  // Net saving for the month.
  (ctx) => {
    if (ctx.totals.incomeMinor === 0) return null;
    const positive = ctx.totals.netMinor > 0;
    return {
      id: 'net-savings',
      kind: positive ? 'milestone' : 'attention',
      tone: positive ? 'positive' : 'caution',
      icon: positive ? 'piggy-bank' : 'alert-triangle',
      title: positive ? 'You saved money this month' : 'You spent more than you received',
      detail: positive
        ? '{{net}} is left over from {{income}} received — a {{rate}} savings rate.'
        : 'Your spending exceeded what came in by {{net}}.',
      facts: {
        netMinor: Math.abs(ctx.totals.netMinor),
        incomeMinor: ctx.totals.incomeMinor,
        expenseMinor: ctx.totals.expenseMinor,
        savingsRateBps: ratioBps(ctx.totals.netMinor, ctx.totals.incomeMinor),
      },
    };
  },

  // Recurring cost awareness.
  (ctx) => {
    if (ctx.subscriptionCount === 0) return null;
    return {
      id: 'subscription-load',
      kind: 'composition',
      tone: 'neutral',
      icon: 'repeat',
      title: 'Your recurring payments',
      detail:
        '{{count}} subscription{{plural}} add up to {{monthly}} per month, ' +
        'or {{yearly}} across a year.',
      facts: {
        count: ctx.subscriptionCount,
        plural: ctx.subscriptionCount === 1 ? '' : 's',
        monthlyMinor: ctx.subscriptionMonthlyMinor,
        yearlyMinor: ctx.subscriptionMonthlyMinor * 12,
        shareOfIncomeBps: ratioBps(ctx.subscriptionMonthlyMinor, ctx.totals.incomeMinor),
      },
    };
  },

  // Spending rhythm.
  (ctx) => {
    if (ctx.daysElapsed < 7 || ctx.totals.expenseCount < 5) return null;
    const spendFreeDays = ctx.daysElapsed - ctx.daysWithSpending;
    if (spendFreeDays < 3) return null;
    return {
      id: 'spend-free-days',
      kind: 'pattern',
      tone: 'positive',
      icon: 'calendar-check',
      title: `${spendFreeDays} days with no spending`,
      detail: 'You recorded no expenses on {{days}} of the {{elapsed}} days so far this month.',
      facts: { days: spendFreeDays, elapsed: ctx.daysElapsed, spendingDays: ctx.daysWithSpending },
    };
  },

  // Single large expense.
  (ctx) => {
    const biggest = ctx.biggestSingleExpense;
    if (!biggest || ctx.totals.expenseMinor === 0) return null;
    const share = ratioBps(biggest.amountMinor, ctx.totals.expenseMinor);
    if (share < 2500) return null;
    return {
      id: 'dominant-expense',
      kind: 'composition',
      tone: 'neutral',
      icon: 'receipt',
      title: 'One expense shaped this month',
      detail: `"${biggest.description}" alone was {{share}} of everything you spent.`,
      facts: { amountMinor: biggest.amountMinor, shareBps: share, description: biggest.description },
    };
  },

  // Goal progress.
  (ctx) => {
    const best = ctx.goalProgress
      .filter((g) => g.progressBps > 0)
      .sort((a, b) => b.progressBps - a.progressBps)[0];
    if (!best) return null;
    return {
      id: `goal-progress:${best.name}`,
      kind: 'milestone',
      tone: 'positive',
      icon: 'target',
      title: `${best.name} is {{progress}} funded`,
      detail: 'You have set aside {{saved}} towards it so far.',
      facts: { progressBps: best.progressBps, savedMinor: best.savedMinor, goal: best.name },
    };
  },

  // Outstanding debt.
  (ctx) => {
    if (ctx.outstandingDebtMinor <= 0) return null;
    return {
      id: 'debt-outstanding',
      kind: 'attention',
      tone: 'caution',
      icon: 'handshake',
      title: 'Money you still owe',
      detail: '{{amount}} is outstanding across your recorded debts.',
      facts: { amountMinor: ctx.outstandingDebtMinor },
    };
  },
];

function buildContext(
  db: Database,
  options: { month?: MonthKey; timeZone?: string } = {},
): InsightContext {
  const timeZone = options.timeZone ?? LOCAL_TIMEZONE;
  const today = todayKey(timeZone);
  const month = options.month ?? today.slice(0, 7);
  const previousMonth = shiftMonth(month, -1);
  const range = monthBounds(month);
  const previousRange = monthBounds(previousMonth);

  const subscriptions = subscriptionSummary(db, { today, timeZone });

  // Distinct days with at least one expense, and the single biggest expense,
  // in one pass over the window.
  const spendingDays = new Set<string>();
  let biggestSingleExpense: InsightContext['biggestSingleExpense'] = null;
  for (const transaction of db.transactions) {
    if (transaction.type !== 'expense') continue;
    const day = toDateKey(transaction.occurredAt, timeZone);
    if (day < range.from || day > range.to) continue;
    spendingDays.add(day);
    if (!biggestSingleExpense || transaction.amountMinor > biggestSingleExpense.amountMinor) {
      biggestSingleExpense = {
        description: transaction.description,
        amountMinor: transaction.amountMinor,
      };
    }
  }

  // The month may not be over; only count days that have actually happened.
  const lastDay = today < range.to ? today : range.to;
  const daysElapsed = Math.max(
    1,
    Math.round(
      (Date.parse(`${lastDay}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000,
    ) + 1,
  );

  return {
    month,
    previousMonth,
    totals: periodTotals(db, range, timeZone),
    previousTotals: periodTotals(db, previousRange, timeZone),
    categories: categoryBreakdown(db, range, 'expense', timeZone),
    previousCategories: categoryBreakdown(db, previousRange, 'expense', timeZone),
    subscriptionMonthlyMinor: subscriptions.monthlyTotalMinor,
    subscriptionCount: subscriptions.activeCount,
    goalProgress: goalViews(db, { today, timeZone })
      .filter((g) => g.status === 'active')
      .map((g) => ({ name: g.name, progressBps: g.progressBps, savedMinor: g.savedMinor })),
    daysWithSpending: spendingDays.size,
    daysElapsed,
    biggestSingleExpense,
    outstandingDebtMinor: debtTotals(db, { today, timeZone }).iOweMinor,
  };
}

/**
 * Runs every rule. A rule that throws is skipped rather than taking the whole
 * panel down — an insight is a nicety, not a feature the user depends on.
 */
export function insightsFor(
  db: Database,
  options: { month?: MonthKey; timeZone?: string } = {},
): Insight[] {
  const ctx = buildContext(db, options);
  const out: Insight[] = [];
  for (const rule of RULES) {
    try {
      const insight = rule(ctx);
      if (insight) out.push(insight);
    } catch {
      // Ignore and carry on with the remaining rules.
    }
  }
  return out;
}
