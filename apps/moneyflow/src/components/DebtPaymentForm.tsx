import { useEffect, useState } from 'react';
import { Handshake } from 'lucide-react';
import { AppError } from '@/lib/errors';
import { formatMoney, parseAmount } from '@/lib/money';
import { useCurrentUser } from '@/contexts/ProfileContext';
import { useToast } from '@/contexts/ToastContext';
import { useAccounts, useAddRepayment, useCategories, useDebts } from '@/hooks/queries';
import { AmountInput, Input, Select, Switch } from './ui/Field';
import { Button } from './ui/Button';
import { EmptyState } from './ui/Skeleton';
import { todayKey } from '@/lib/dates';

/**
 * Records a repayment and, optionally, the matching ledger transaction — so
 * "I paid Ravi ₹2,000" reduces both the debt and the bank balance in one step.
 */
export function DebtPaymentForm({
  onDone, onCancel, initialDebtId,
}: {
  onDone: () => void;
  onCancel: () => void;
  initialDebtId?: string;
}) {
  const user = useCurrentUser();
  const toast = useToast();
  const { data, isLoading } = useDebts();
  const { data: accountData } = useAccounts();
  const { data: expenseCategories = [] } = useCategories('expense');
  const { data: incomeCategories = [] } = useCategories('income');

  const [debtId, setDebtId] = useState(initialDebtId ?? '');
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(todayKey());
  const [postTransaction, setPostTransaction] = useState(true);
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const mutation = useAddRepayment();

  const open = (data?.debts ?? []).filter(
    (debt) => debt.status === 'pending' || debt.status === 'partially_paid',
  );
  const selected = open.find((debt) => debt.id === debtId);
  const accounts = accountData?.accounts ?? [];
  const categories = selected?.direction === 'i_owe' ? expenseCategories : incomeCategories;

  useEffect(() => {
    if (!debtId && open.length > 0) setDebtId(open[0]?.id ?? '');
  }, [open, debtId]);

  useEffect(() => {
    if (!accountId && accounts.length > 0) {
      setAccountId((accounts.find((account) => account.isDefault) ?? accounts[0])?.id ?? '');
    }
  }, [accounts, accountId]);

  useEffect(() => {
    if (categories.length > 0) {
      const preferred =
        categories.find((category) => category.name === 'EMI') ??
        categories.find((category) => category.name === 'Other') ??
        categories[0];
      setCategoryId((current) =>
        categories.some((category) => category.id === current) ? current : preferred?.id ?? '',
      );
    }
  }, [categories]);

  if (!isLoading && open.length === 0) {
    return (
      <EmptyState
        icon={<Handshake className="h-6 w-6" aria-hidden />}
        title="Nothing outstanding"
        description="You have no open debts to record a repayment against."
        action={<Button variant="outline" onClick={onCancel}>Back</Button>}
      />
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const minor = parseAmount(amount, user.currency);
    if (minor === null || minor <= 0) {
      setErrors({ amount: 'Enter an amount.' });
      return;
    }
    if (selected && minor > selected.outstandingMinor) {
      setErrors({
        amount: `That is more than the ${formatMoney(selected.outstandingMinor, user.currency)} outstanding.`,
      });
      return;
    }
    try {
      await mutation.mutateAsync({
        debtId,
        amount,
        paidOn,
        ...(postTransaction ? { accountId, categoryId } : {}),
      });
      toast.success('Repayment recorded');
      onDone();
    } catch (error) {
      toast.error(error instanceof AppError ? error.message : 'That did not save.');
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <Select
        label="Debt"
        required
        options={open.map((debt) => ({
          value: debt.id,
          label: `${debt.direction === 'i_owe' ? 'I owe' : 'Owed to me'} · ${debt.counterparty} · ${formatMoney(debt.outstandingMinor, user.currency)}`,
        }))}
        value={debtId}
        onChange={(event) => setDebtId(event.target.value)}
      />

      <AmountInput
        data-autofocus
        currency={user.currency}
        emphasis
        label="Amount"
        required
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        error={errors.amount}
        hint={selected ? `${formatMoney(selected.outstandingMinor, user.currency)} outstanding` : undefined}
      />

      <Input
        label="Date"
        type="date"
        value={paidOn}
        onChange={(event) => setPaidOn(event.target.value)}
      />

      <div className="rounded-xl border border-line p-3.5">
        <Switch
          checked={postTransaction}
          onChange={setPostTransaction}
          label="Also record it in my ledger"
          description={
            selected?.direction === 'i_owe'
              ? 'Adds a matching expense so the money leaves the account too.'
              : 'Adds matching income so the money arrives in the account too.'
          }
        />
        {postTransaction && (
          <div className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              label="Account"
              options={accounts.map((account) => ({ value: account.id, label: account.name }))}
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
            />
            <Select
              label="Category"
              options={categories.map((category) => ({ value: category.id, label: category.name }))}
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            />
          </div>
        )}
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={mutation.isPending}>
          Back
        </Button>
        <Button type="submit" loading={mutation.isPending}>Record repayment</Button>
      </div>
    </form>
  );
}
