import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { AppError } from '@/lib/errors';
import { parseAmount, toAmountInput } from '@/lib/money';
import { toDateInputValue, todayKey } from '@/lib/dates';
import { useCurrentUser } from '@/contexts/ProfileContext';
import { useToast } from '@/contexts/ToastContext';
import {
  useAccounts, useCategories, useCreateTransaction, useFrequentCategories, useUpdateTransaction,
} from '@/hooks/queries';
import type { PaymentMethod, Transaction, TransactionType } from '@/types/api';
import { AmountInput, Input, Select, Textarea } from './ui/Field';
import { Button } from './ui/Button';
import { IconTile } from './Icon';
import { Skeleton } from './ui/Skeleton';

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'upi', label: 'UPI' },
  { value: 'cash', label: 'Cash' },
  { value: 'debit_card', label: 'Debit card' },
  { value: 'credit_card', label: 'Credit card' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'netbanking', label: 'Net banking' },
  { value: 'auto_debit', label: 'Auto debit' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
];

export interface TransactionFormProps {
  type: TransactionType;
  /** Present when editing rather than creating. */
  existing?: Transaction;
  onDone: () => void;
  onCancel: () => void;
}

interface FormState {
  amount: string;
  accountId: string;
  toAccountId: string;
  categoryId: string;
  description: string;
  notes: string;
  paymentMethod: PaymentMethod;
  date: string;
}

/**
 * The form behind every way of recording money.
 *
 * Optimised for the section-44 target — a normal expense in under ten seconds:
 *   • the amount field is focused on open and shows a numeric keypad,
 *   • the six categories the user actually uses appear as one-tap chips,
 *   • the account defaults to their default account,
 *   • the date defaults to today,
 *   • and the description is optional, falling back to the category name.
 *
 * Validation happens on submit rather than on every keystroke, so the form does
 * not shout at someone who is still typing.
 */
export function TransactionForm({ type, existing, onDone, onCancel }: TransactionFormProps) {
  const user = useCurrentUser();
  const toast = useToast();
  const isEdit = Boolean(existing);
  const isTransfer = type === 'transfer';
  const categoryKind = type === 'income' ? 'income' : 'expense';

  const { data: accountData, isLoading: accountsLoading } = useAccounts();
  const { data: categories = [], isLoading: categoriesLoading } = useCategories(
    isTransfer ? undefined : categoryKind,
  );
  const { data: frequent = [] } = useFrequentCategories(categoryKind);

  const accounts = useMemo(() => accountData?.accounts ?? [], [accountData]);
  const amountRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState<FormState>(() => ({
    amount: existing ? toAmountInput(existing.amountMinor, existing.currency) : '',
    accountId: existing?.account.id ?? '',
    toAccountId: existing?.toAccount?.id ?? '',
    categoryId: existing?.category?.id ?? '',
    description: existing?.description ?? '',
    notes: existing?.notes ?? '',
    paymentMethod: existing?.paymentMethod ?? (type === 'income' ? 'bank_transfer' : 'upi'),
    date: existing ? toDateInputValue(existing.occurredAt) : todayKey(),
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showDetails, setShowDetails] = useState(Boolean(existing?.notes));

  // Seed the account defaults once the account list has arrived.
  useEffect(() => {
    if (accounts.length === 0) return;
    setForm((current) => {
      if (current.accountId) return current;
      const preferred = accounts.find((account) => account.isDefault) ?? accounts[0];
      const destination =
        isTransfer ? accounts.find((account) => account.id !== preferred?.id) : undefined;
      return {
        ...current,
        accountId: preferred?.id ?? '',
        toAccountId: current.toAccountId || destination?.id || '',
      };
    });
  }, [accounts, isTransfer]);

  const createMutation = useCreateTransaction();
  const updateMutation = useUpdateTransaction();
  const pending = createMutation.isPending || updateMutation.isPending;

  const chips = frequent.length > 0 ? frequent : categories.slice(0, 6);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  function validate(): boolean {
    const found: Record<string, string> = {};
    const minor = parseAmount(form.amount, user.currency);

    if (minor === null) found.amount = 'Enter a valid amount.';
    else if (type !== 'adjustment' && minor <= 0) found.amount = 'Amount must be more than zero.';
    else if (type === 'adjustment' && minor === 0) found.amount = 'An adjustment cannot be zero.';

    if (!form.accountId) found.accountId = 'Choose an account.';
    if (isTransfer) {
      if (!form.toAccountId) found.toAccountId = 'Choose where the money goes.';
      else if (form.toAccountId === form.accountId) found.toAccountId = 'Pick two different accounts.';
    } else if (type !== 'adjustment' && !form.categoryId) {
      found.categoryId = 'Choose a category.';
    }
    if (form.date > todayKey()) {
      // Future-dating is allowed for planning, but a typo in the year is not.
      const year = Number(form.date.slice(0, 4));
      if (year > new Date().getFullYear() + 5) found.date = 'That date looks wrong.';
    }

    setErrors(found);
    if (Object.keys(found).length > 0) {
      const firstKey = Object.keys(found)[0];
      if (firstKey === 'amount') amountRef.current?.focus();
      return false;
    }
    return true;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!validate()) return;

    const fallbackDescription =
      categories.find((category) => category.id === form.categoryId)?.name ??
      (isTransfer ? 'Transfer' : 'Transaction');

    const payload = {
      type,
      amount: form.amount,
      accountId: form.accountId,
      toAccountId: isTransfer ? form.toAccountId : null,
      categoryId: isTransfer || type === 'adjustment' ? null : form.categoryId,
      description: form.description.trim() || fallbackDescription,
      notes: form.notes.trim() || null,
      paymentMethod: form.paymentMethod,
      occurredAt: form.date,
    };

    try {
      if (existing) {
        await updateMutation.mutateAsync({ id: existing.id, patch: payload });
        toast.success('Transaction updated', 'Your balances have been recalculated.');
      } else {
        await createMutation.mutateAsync(payload);
        toast.success(
          type === 'income' ? 'Money added' : isTransfer ? 'Transfer recorded' : 'Expense recorded',
          'Your balance is up to date.',
        );
      }
      onDone();
    } catch (error) {
      if (error instanceof AppError) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of error.details) fieldErrors[issue.field] = issue.message;
        setErrors(fieldErrors);
        toast.error(error.message);
      } else {
        toast.error('That did not save', 'Please try again.');
      }
    }
  }

  if (accountsLoading || categoriesLoading) {
    return (
      <div className="space-y-4 py-2">
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-11 rounded-xl" />
        <Skeleton className="h-11 rounded-xl" />
      </div>
    );
  }

  const accountOptions = accounts.map((account) => ({
    value: account.id,
    label: account.name,
  }));

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <AmountInput
        ref={amountRef}
        data-autofocus
        currency={user.currency}
        emphasis
        label="Amount"
        required
        value={form.amount}
        onChange={(event) => update('amount', event.target.value)}
        error={errors.amount}
        hint={type === 'adjustment' ? 'Use a minus sign to reduce the balance.' : undefined}
      />

      {!isTransfer && type !== 'adjustment' && (
        <div className="space-y-2">
          <span className="block text-sm font-medium text-ink">
            {type === 'income' ? 'Source' : 'Category'}
            <span className="ml-0.5 text-negative" aria-hidden>*</span>
          </span>

          {chips.length > 0 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Frequently used categories">
              {chips.map((category) => {
                const active = form.categoryId === category.id;
                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => update('categoryId', category.id)}
                    aria-pressed={active}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-sm font-medium transition-all',
                      active
                        ? 'border-brand bg-brand-soft text-brand-ink'
                        : 'border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink',
                    )}
                  >
                    <IconTile icon={category.icon} color={category.color} size="sm" className="h-6 w-6 rounded-md" />
                    {category.name}
                    {active && <Check className="h-3.5 w-3.5" aria-hidden />}
                  </button>
                );
              })}
            </div>
          )}

          <Select
            aria-label="All categories"
            options={categories.map((category) => ({ value: category.id, label: category.name }))}
            placeholder="Choose a category…"
            value={form.categoryId}
            onChange={(event) => update('categoryId', event.target.value)}
            error={errors.categoryId}
          />
        </div>
      )}

      {isTransfer ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
          <Select
            label="From"
            required
            options={accountOptions}
            value={form.accountId}
            onChange={(event) => update('accountId', event.target.value)}
            error={errors.accountId}
          />
          <div className="hidden pb-3 text-ink-3 sm:block" aria-hidden>
            <ArrowRight className="h-5 w-5" />
          </div>
          <Select
            label="To"
            required
            options={accountOptions.filter((option) => option.value !== form.accountId)}
            value={form.toAccountId}
            onChange={(event) => update('toAccountId', event.target.value)}
            error={errors.toAccountId}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label="Account"
            required
            options={accountOptions}
            value={form.accountId}
            onChange={(event) => update('accountId', event.target.value)}
            error={errors.accountId}
          />
          <Select
            label="Payment method"
            options={PAYMENT_METHODS.map((method) => ({ value: method.value, label: method.label }))}
            value={form.paymentMethod}
            onChange={(event) => update('paymentMethod', event.target.value as PaymentMethod)}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          label="Description"
          placeholder={type === 'income' ? 'Salary, refund…' : 'What was it for?'}
          value={form.description}
          onChange={(event) => update('description', event.target.value)}
          error={errors.description}
          maxLength={140}
        />
        <Input
          label="Date"
          type="date"
          value={form.date}
          onChange={(event) => update('date', event.target.value)}
          error={errors.date}
          max="2099-12-31"
        />
      </div>

      {showDetails ? (
        <Textarea
          label="Notes"
          placeholder="Anything worth remembering about this…"
          value={form.notes}
          onChange={(event) => update('notes', event.target.value)}
          maxLength={2000}
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowDetails(true)}
          className="text-sm font-medium text-brand hover:underline"
        >
          + Add a note
        </button>
      )}

      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending} variant={type === 'expense' ? 'primary' : 'primary'}>
          {isEdit ? 'Save changes' : type === 'income' ? 'Add money' : isTransfer ? 'Transfer' : 'Save expense'}
        </Button>
      </div>
    </form>
  );
}
