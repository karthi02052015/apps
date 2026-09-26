import { useState } from 'react';
import {
  ArrowLeftRight, CalendarDays, CreditCard, FileText, Pencil, Repeat, Trash2, Wallet,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { AppError } from '@/lib/errors';
import { formatSigned } from '@/lib/money';
import { fullDateLabel, timeLabel } from '@/lib/dates';
import { useToast } from '@/contexts/ToastContext';
import { useDeleteTransaction } from '@/hooks/queries';
import type { Transaction } from '@/types/api';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { ConfirmDialog, Modal } from './ui/Modal';
import { IconTile } from './Icon';
import { TransactionForm } from './TransactionForm';

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash', upi: 'UPI', debit_card: 'Debit card', credit_card: 'Credit card',
  bank_transfer: 'Bank transfer', netbanking: 'Net banking', cheque: 'Cheque',
  auto_debit: 'Auto debit', other: 'Other',
};

const TYPE_LABELS: Record<string, string> = {
  income: 'Income', expense: 'Expense', transfer: 'Transfer', adjustment: 'Adjustment',
};

/** The detail view behind a transaction row (section 14). */
export function TransactionDetail({
  transaction, onClose,
}: {
  transaction: Transaction;
  onClose: () => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const deleteMutation = useDeleteTransaction();

  const isTransfer = transaction.type === 'transfer';

  async function handleDelete() {
    try {
      await deleteMutation.mutateAsync(transaction.id);
      toast.success('Transaction deleted', 'Your balances have been updated.');
      setConfirming(false);
      onClose();
    } catch (error) {
      toast.error(error instanceof AppError ? error.message : 'That could not be deleted.');
    }
  }

  if (editing) {
    return (
      <TransactionForm
        type={transaction.type}
        existing={transaction}
        onDone={() => {
          setEditing(false);
          onClose();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div>
      <div className="flex flex-col items-center border-b border-line pb-6 text-center">
        {isTransfer ? (
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-3 text-ink-2" aria-hidden>
            <ArrowLeftRight className="h-7 w-7" />
          </span>
        ) : (
          <IconTile
            icon={transaction.category?.icon ?? transaction.account.icon}
            color={transaction.category?.color ?? transaction.account.color}
            size="lg"
          />
        )}
        <p
          className={cn(
            'tnum mt-3 text-3xl font-bold tracking-tight',
            transaction.type === 'income' ? 'text-positive'
              : transaction.type === 'expense' ? 'text-negative'
              : 'text-ink',
          )}
        >
          {formatSigned(transaction.amountMinor, transaction.type, transaction.currency)}
        </p>
        <p className="mt-1 text-base font-medium text-ink">{transaction.description}</p>
        <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5">
          <Badge
            tone={transaction.type === 'income' ? 'positive' : transaction.type === 'expense' ? 'negative' : 'neutral'}
          >
            {TYPE_LABELS[transaction.type]}
          </Badge>
          {transaction.isRecurring && (
            <Badge tone="brand" icon={<Repeat className="h-3 w-3" aria-hidden />}>Recurring</Badge>
          )}
          {transaction.isSample && <Badge tone="brand">Sample data</Badge>}
        </div>
      </div>

      <dl className="divide-y divide-line">
        {transaction.category && (
          <DetailRow icon={FileText} label="Category" value={transaction.category.name} />
        )}
        <DetailRow
          icon={Wallet}
          label={isTransfer ? 'From' : 'Account'}
          value={transaction.account.name}
        />
        {transaction.toAccount && (
          <DetailRow icon={Wallet} label="To" value={transaction.toAccount.name} />
        )}
        {!isTransfer && (
          <DetailRow
            icon={CreditCard}
            label="Payment method"
            value={METHOD_LABELS[transaction.paymentMethod] ?? transaction.paymentMethod}
          />
        )}
        <DetailRow
          icon={CalendarDays}
          label="Date"
          value={`${fullDateLabel(transaction.occurredAt)} · ${timeLabel(transaction.occurredAt)}`}
        />
        {transaction.notes && (
          <div className="py-3.5">
            <dt className="flex items-center gap-2 text-sm text-ink-2">
              <FileText className="h-4 w-4" aria-hidden />
              Notes
            </dt>
            <dd className="mt-1.5 whitespace-pre-wrap rounded-xl bg-surface-2 p-3 text-sm text-ink">
              {transaction.notes}
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-5 flex gap-2">
        <Button
          variant="outline"
          fullWidth
          leftIcon={<Pencil className="h-4 w-4" aria-hidden />}
          onClick={() => setEditing(true)}
        >
          Edit
        </Button>
        <Button
          variant="danger"
          fullWidth
          leftIcon={<Trash2 className="h-4 w-4" aria-hidden />}
          onClick={() => setConfirming(true)}
        >
          Delete
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={handleDelete}
        title="Delete this transaction?"
        message={
          <>
            <strong className="font-semibold text-ink">{transaction.description}</strong> for{' '}
            {formatSigned(transaction.amountMinor, transaction.type, transaction.currency)} will be
            removed and your balances will be recalculated. This cannot be undone.
          </>
        }
        confirmLabel="Delete transaction"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}

function DetailRow({
  icon: Icon, label, value,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <dt className="flex items-center gap-2 text-sm text-ink-2">
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        {label}
      </dt>
      <dd className="truncate text-sm font-medium text-ink">{value}</dd>
    </div>
  );
}

/** Convenience wrapper: the detail view as a modal. */
export function TransactionDetailModal({
  transaction, onClose,
}: {
  transaction: Transaction | null;
  onClose: () => void;
}) {
  return (
    <Modal open={transaction !== null} onClose={onClose} title="Transaction" size="lg">
      {transaction && <TransactionDetail transaction={transaction} onClose={onClose} />}
    </Modal>
  );
}
