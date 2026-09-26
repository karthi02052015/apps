import { ArrowLeftRight, Repeat, Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';
import { relativeDayLabel, timeLabel } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import type { Transaction } from '@/types/api';
import { IconTile } from './Icon';
import { MoneyText } from './MoneyText';
import { Badge } from './ui/Badge';

/**
 * One row in the ledger.
 *
 * The type is carried by an icon, a sign and a colour together — never colour
 * alone (section 54) — and the running balance is shown when the list provides
 * it, so "where did my money go" is answerable by scanning one column.
 */
export function TransactionItem({
  transaction, onClick, showDate = false, showBalance = false, dense = false,
}: {
  transaction: Transaction;
  onClick?: (transaction: Transaction) => void;
  showDate?: boolean;
  showBalance?: boolean;
  dense?: boolean;
}) {
  const { type, category, account, toAccount } = transaction;
  const isTransfer = type === 'transfer';

  const subtitle = isTransfer
    ? `${account.name} → ${toAccount?.name ?? 'Account'}`
    : [category?.name, account.name].filter(Boolean).join(' · ');

  const Row = onClick ? 'button' : 'div';

  return (
    <Row
      {...(onClick ? { type: 'button' as const, onClick: () => onClick(transaction) } : {})}
      className={cn(
        'flex w-full items-center gap-3 text-left transition-colors',
        dense ? 'px-3 py-2.5' : 'px-4 py-3 sm:px-5',
        onClick && 'hover:bg-surface-2 active:bg-surface-3',
      )}
    >
      {isTransfer ? (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-3 text-ink-2" aria-hidden>
          <ArrowLeftRight className="h-5 w-5" />
        </span>
      ) : (
        <IconTile icon={category?.icon ?? account.icon} color={category?.color ?? account.color} />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-semibold text-ink">{transaction.description}</p>
          {transaction.isRecurring && (
            <Repeat className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-label="Recurring" />
          )}
          {transaction.isSample && (
            <Badge tone="brand" className="shrink-0" icon={<Sparkles className="h-3 w-3" aria-hidden />}>
              Sample
            </Badge>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-ink-2">
          {showDate && `${relativeDayLabel(transaction.occurredAt)} · `}
          {subtitle}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <MoneyText
          minor={transaction.amountMinor}
          currency={transaction.currency}
          type={type}
          className="text-sm"
        />
        <p className="mt-0.5 text-xs text-ink-3">
          {showBalance && transaction.runningBalanceMinor !== undefined
            ? formatMoney(transaction.runningBalanceMinor, transaction.currency, { abbreviate: true })
            : timeLabel(transaction.occurredAt)}
        </p>
      </div>
    </Row>
  );
}

/** Groups a flat list into day sections, the way a bank statement reads. */
export function groupByDay(transactions: Transaction[]): { label: string; items: Transaction[] }[] {
  const groups: { label: string; items: Transaction[] }[] = [];
  for (const transaction of transactions) {
    const label = relativeDayLabel(transaction.occurredAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(transaction);
    else groups.push({ label, items: [transaction] });
  }
  return groups;
}
