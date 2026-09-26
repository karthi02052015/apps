/**
 * Debts — money lent and money borrowed.
 *
 * Outstanding balance is derived from the payments, like every other figure in
 * the app. Status is derived from the outstanding balance rather than stored,
 * so a deleted repayment moves a debt back from "paid" to "partially paid"
 * with no extra bookkeeping.
 *
 * A repayment optionally creates a linked transaction — "I paid Ravi ₹2,000"
 * both reduces the debt and moves the money out of an account. The two are
 * created and deleted together (see `addRepayment` in `operations.ts`), so
 * they can never disagree.
 */
import type {
  Database, Debt, DebtPayment, DebtStatus, DebtView, DebtDirection, DateKey, MinorUnits,
} from './types';
import { ratioBps } from './money';
import { LOCAL_TIMEZONE, todayKey } from './dates';

export function paymentsFor(db: Database, debtId: string): DebtPayment[] {
  return db.debtPayments
    .filter((p) => p.debtId === debtId)
    .sort((a, b) => b.paidOn.localeCompare(a.paidOn) || b.createdAt.localeCompare(a.createdAt));
}

export function paidMinor(db: Database, debtId: string): MinorUnits {
  let total = 0;
  for (const payment of db.debtPayments) {
    if (payment.debtId === debtId) total += payment.amountMinor;
  }
  return total;
}

export function debtStatus(debt: Debt, outstandingMinor: MinorUnits, paid: MinorUnits): DebtStatus {
  if (debt.isWrittenOff) return 'written_off';
  if (outstandingMinor <= 0) return 'paid';
  return paid > 0 ? 'partially_paid' : 'pending';
}

export function toDebtView(db: Database, debt: Debt, today: DateKey): DebtView {
  const paid = paidMinor(db, debt.id);
  const outstandingMinor = Math.max(0, debt.principalMinor - paid);
  const status = debtStatus(debt, outstandingMinor, paid);

  return {
    ...debt,
    paidMinor: paid,
    outstandingMinor,
    progressBps: ratioBps(paid, debt.principalMinor),
    status,
    isOverdue: Boolean(
      debt.dueDate && debt.dueDate < today && (status === 'pending' || status === 'partially_paid'),
    ),
    payments: paymentsFor(db, debt.id),
  };
}

const STATUS_ORDER: Record<DebtStatus, number> = {
  pending: 0, partially_paid: 1, paid: 2, written_off: 3,
};

export function debtViews(
  db: Database,
  options: {
    direction?: DebtDirection;
    status?: DebtStatus;
    today?: DateKey;
    timeZone?: string;
  } = {},
): DebtView[] {
  const today = options.today ?? todayKey(options.timeZone ?? LOCAL_TIMEZONE);
  return db.debts
    .filter((debt) => !options.direction || debt.direction === options.direction)
    .map((debt) => toDebtView(db, debt, today))
    .filter((view) => !options.status || view.status === options.status)
    .sort((a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') ||
      a.counterparty.localeCompare(b.counterparty));
}

export interface DebtTotals {
  iOweMinor: MinorUnits;
  owedToMeMinor: MinorUnits;
  /** Positive when more is owed to the user than by them. */
  netMinor: MinorUnits;
  iOweCount: number;
  owedToMeCount: number;
  overdueCount: number;
}

/** Only live debts count: a settled or written-off debt owes nothing. */
export function debtTotals(db: Database, options: { today?: DateKey; timeZone?: string } = {}): DebtTotals {
  const views = debtViews(db, options).filter(
    (d) => d.status === 'pending' || d.status === 'partially_paid',
  );
  const iOwe = views.filter((d) => d.direction === 'i_owe');
  const owedToMe = views.filter((d) => d.direction === 'owed_to_me');
  const iOweMinor = iOwe.reduce((sum, d) => sum + d.outstandingMinor, 0);
  const owedToMeMinor = owedToMe.reduce((sum, d) => sum + d.outstandingMinor, 0);

  return {
    iOweMinor,
    owedToMeMinor,
    netMinor: owedToMeMinor - iOweMinor,
    iOweCount: iOwe.length,
    owedToMeCount: owedToMe.length,
    overdueCount: views.filter((d) => d.isOverdue).length,
  };
}
