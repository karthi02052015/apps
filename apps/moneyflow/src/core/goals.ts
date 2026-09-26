/**
 * Savings goals.
 *
 * Progress is the sum of the goal's signed contributions, never a stored
 * running figure — the same derive-don't-cache rule used for account balances,
 * for the same reason: a deleted contribution cannot leave a phantom behind.
 *
 * A contribution is deliberately *not* a transaction. Money set aside for a
 * holiday is still in the user's bank account; treating it as an expense would
 * make their net worth wrong.
 */
import type { Database, Goal, GoalContribution, GoalView, MinorUnits } from './types';
import { ratioBps } from './money';
import { LOCAL_TIMEZONE, daysBetween, todayKey } from './dates';

/** Average days in a Gregorian month — used to turn a deadline into months. */
const DAYS_PER_MONTH = 30.4375;

export function contributionsFor(db: Database, goalId: string): GoalContribution[] {
  return db.goalContributions
    .filter((c) => c.goalId === goalId)
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.createdAt.localeCompare(a.createdAt));
}

export function savedMinor(db: Database, goalId: string): MinorUnits {
  let total = 0;
  for (const contribution of db.goalContributions) {
    if (contribution.goalId === goalId) total += contribution.amountMinor;
  }
  return total;
}

export function toGoalView(
  db: Database,
  goal: Goal,
  options: { today?: string; timeZone?: string } = {},
): GoalView {
  const today = options.today ?? todayKey(options.timeZone ?? LOCAL_TIMEZONE);
  const saved = savedMinor(db, goal.id);
  const remainingMinor = Math.max(0, goal.targetMinor - saved);

  let daysRemaining: number | null = null;
  let monthlyNeededMinor: MinorUnits | null = null;
  if (goal.targetDate) {
    daysRemaining = daysBetween(today, goal.targetDate);
    // Ceiling, not floor: under-saving misses the deadline, over-saving does not.
    const months = Math.max(1, Math.ceil(daysRemaining / DAYS_PER_MONTH));
    monthlyNeededMinor = remainingMinor > 0 ? Math.ceil(remainingMinor / months) : 0;
  }

  return {
    ...goal,
    savedMinor: saved,
    remainingMinor,
    progressBps: ratioBps(saved, goal.targetMinor),
    monthlyNeededMinor,
    daysRemaining,
    contributions: contributionsFor(db, goal.id),
  };
}

const STATUS_ORDER: Record<Goal['status'], number> = { active: 0, achieved: 1, archived: 2 };

export function goalViews(
  db: Database,
  options: { includeArchived?: boolean; today?: string; timeZone?: string } = {},
): GoalView[] {
  return db.goals
    .filter((goal) => options.includeArchived || goal.status !== 'archived')
    .map((goal) => toGoalView(db, goal, options))
    .sort((a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      // Goals without a deadline sort last within their status group.
      (a.targetDate ?? '9999-12-31').localeCompare(b.targetDate ?? '9999-12-31') ||
      a.createdAt.localeCompare(b.createdAt));
}

export interface GoalSummary {
  totalTargetMinor: MinorUnits;
  totalSavedMinor: MinorUnits;
  progressBps: number;
  activeCount: number;
  achievedCount: number;
  goals: GoalView[];
}

export function goalSummary(db: Database, options: { today?: string; timeZone?: string } = {}): GoalSummary {
  const goals = goalViews(db, options);
  const live = goals.filter((g) => g.status !== 'archived');
  const totalTargetMinor = live.reduce((sum, g) => sum + g.targetMinor, 0);
  const totalSavedMinor = live.reduce((sum, g) => sum + g.savedMinor, 0);
  return {
    totalTargetMinor,
    totalSavedMinor,
    progressBps: ratioBps(totalSavedMinor, totalTargetMinor),
    activeCount: goals.filter((g) => g.status === 'active').length,
    achievedCount: goals.filter((g) => g.status === 'achieved').length,
    goals,
  };
}

/** Total set aside across every goal that is not archived. */
export function totalSavedMinor(db: Database): MinorUnits {
  const live = new Set(db.goals.filter((g) => g.status !== 'archived').map((g) => g.id));
  let total = 0;
  for (const contribution of db.goalContributions) {
    if (live.has(contribution.goalId)) total += contribution.amountMinor;
  }
  return total;
}
