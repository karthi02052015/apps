import { useState } from 'react';
import { Archive, ArchiveRestore, Pencil, Plus, Star, Trash2, Wallet } from 'lucide-react';
import { cn } from '@/lib/cn';
import { AppError } from '@/lib/errors';
import { formatMoney, parseAmount, toAmountInput } from '@/lib/money';
import { useCurrentUser } from '@/contexts/ProfileContext';
import { useToast } from '@/contexts/ToastContext';
import {
  useAccounts, useCreateAccount, useDeleteAccount, useUpdateAccount,
} from '@/hooks/queries';
import { PageHeader } from '@/layouts/AppShell';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { AmountInput, Input, Select } from '@/components/ui/Field';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState, RowSkeleton } from '@/components/ui/Skeleton';
import { IconTile } from '@/components/Icon';
import { COLOR_TOKENS, swatch } from '@/lib/tokens';
import type { Account, AccountType } from '@/types/api';

const ACCOUNT_TYPES: { value: AccountType; label: string; icon: string }[] = [
  { value: 'bank', label: 'Bank account', icon: 'landmark' },
  { value: 'cash', label: 'Cash', icon: 'banknote' },
  { value: 'wallet', label: 'Wallet / UPI', icon: 'wallet' },
  { value: 'savings', label: 'Savings', icon: 'piggy-bank' },
  { value: 'credit_card', label: 'Credit card', icon: 'credit-card' },
  { value: 'investment', label: 'Investment', icon: 'line-chart' },
  { value: 'other', label: 'Other', icon: 'coins' },
];

export function AccountsPage() {
  const user = useCurrentUser();
  const toast = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const { data, isLoading, isError, refetch } = useAccounts(showArchived);
  const [editing, setEditing] = useState<Account | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Account | null>(null);

  const updateMutation = useUpdateAccount();
  const deleteMutation = useDeleteAccount();

  const accounts = data?.accounts ?? [];
  const totals = data?.totals;

  async function handleDelete() {
    if (!deleting) return;
    try {
      await deleteMutation.mutateAsync(deleting.id);
      toast.success('Account deleted');
      setDeleting(null);
    } catch (error) {
      toast.error(error instanceof AppError ? error.message : 'That could not be deleted.');
      setDeleting(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Every place your money sits, and what is in it."
        action={
          <Button onClick={() => setCreating(true)} leftIcon={<Plus className="h-4 w-4" aria-hidden />}>
            New account
          </Button>
        }
      />

      {totals && (
        <Card className="mb-4 bg-gradient-to-br from-brand to-indigo-600 p-5 text-white">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/70">Total balance</p>
          <p className="tnum mt-1.5 text-3xl font-bold tracking-tight">
            {formatMoney(totals.totalMinor, user.currency)}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Bank', totals.bankMinor],
              ['Cash', totals.cashMinor],
              ['Wallet', totals.walletMinor],
              ['Investments', totals.investmentMinor],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-xl bg-white/10 p-3">
                <p className="text-xs text-white/70">{label}</p>
                <p className="tnum mt-0.5 text-sm font-semibold">
                  {formatMoney(value as number, user.currency)}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="mb-3 flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => setShowArchived((value) => !value)}>
          {showArchived ? 'Hide archived' : 'Show archived'}
        </Button>
      </div>

      {isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : isLoading ? (
        <Card><RowSkeleton count={4} /></Card>
      ) : accounts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Wallet className="h-6 w-6" aria-hidden />}
            title="No accounts yet"
            description="Add the places you keep money — a bank account, cash in hand, a wallet."
            action={<Button onClick={() => setCreating(true)}>Add an account</Button>}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {accounts.map((account) => (
            <Card key={account.id} className={cn('overflow-hidden', account.isArchived && 'opacity-60')}>
              <div className="flex items-start gap-3 p-5">
                <IconTile icon={account.icon} color={account.color} size="lg" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <h3 className="truncate font-semibold text-ink">{account.name}</h3>
                    {account.isDefault && (
                      <Star className="h-3.5 w-3.5 shrink-0 fill-caution text-caution" aria-label="Default account" />
                    )}
                  </div>
                  <p className="mt-0.5 text-xs capitalize text-ink-2">
                    {account.type.replace('_', ' ')}
                    {account.institution ? ` · ${account.institution}` : ''}
                  </p>
                  <p
                    className={cn(
                      'tnum mt-2.5 text-2xl font-bold tracking-tight',
                      account.balanceMinor < 0 ? 'text-negative' : 'text-ink',
                    )}
                  >
                    {formatMoney(account.balanceMinor, account.currency)}
                  </p>
                  <p className="mt-1 text-xs text-ink-3">
                    Opened with {formatMoney(account.openingBalanceMinor, account.currency)} ·{' '}
                    {account.transactionCount} {account.transactionCount === 1 ? 'entry' : 'entries'}
                  </p>
                  {account.isArchived && <Badge className="mt-2">Archived</Badge>}
                </div>
              </div>

              <div className="flex items-center gap-1 border-t border-line px-3 py-2">
                <Button variant="ghost" size="sm" onClick={() => setEditing(account)} leftIcon={<Pencil className="h-3.5 w-3.5" aria-hidden />}>
                  Edit
                </Button>
                {!account.isDefault && !account.isArchived && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      updateMutation.mutate(
                        { id: account.id, patch: { isDefault: true } },
                        { onSuccess: () => toast.success(`${account.name} is now your default account`) },
                      )
                    }
                  >
                    Make default
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  onClick={() =>
                    updateMutation.mutate(
                      { id: account.id, patch: { isArchived: !account.isArchived } },
                      {
                        onSuccess: () =>
                          toast.success(account.isArchived ? 'Account restored' : 'Account archived'),
                        onError: (error) =>
                          toast.error(error instanceof AppError ? error.message : 'That did not work.'),
                      },
                    )
                  }
                  aria-label={account.isArchived ? 'Restore account' : 'Archive account'}
                >
                  {account.isArchived ? <ArchiveRestore className="h-3.5 w-3.5" aria-hidden /> : <Archive className="h-3.5 w-3.5" aria-hidden />}
                </Button>
                {account.transactionCount === 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-negative hover:bg-negative-soft"
                    onClick={() => setDeleting(account)}
                    aria-label="Delete account"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <AccountFormModal
        open={creating || editing !== null}
        account={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={handleDelete}
        title="Delete this account?"
        message={`"${deleting?.name}" has no transactions, so deleting it is safe. This cannot be undone.`}
        confirmLabel="Delete account"
        loading={deleteMutation.isPending}
      />
    </>
  );
}

function AccountFormModal({
  open, account, onClose,
}: {
  open: boolean;
  account: Account | null;
  onClose: () => void;
}) {
  const user = useCurrentUser();
  const toast = useToast();
  const createMutation = useCreateAccount();
  const updateMutation = useUpdateAccount();
  const isEdit = account !== null;

  const [form, setForm] = useState({
    name: '', type: 'bank' as AccountType, institution: '', openingBalance: '', color: 'indigo', isDefault: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [initialisedFor, setInitialisedFor] = useState<string | null>(null);

  // Load the account being edited the first time the modal opens for it.
  if (open && account && initialisedFor !== account.id) {
    setInitialisedFor(account.id);
    setForm({
      name: account.name,
      type: account.type,
      institution: account.institution ?? '',
      openingBalance: toAmountInput(account.openingBalanceMinor, account.currency),
      color: account.color,
      isDefault: account.isDefault,
    });
  }
  if (open && !account && initialisedFor !== 'new') {
    setInitialisedFor('new');
    setForm({ name: '', type: 'bank', institution: '', openingBalance: '', color: 'indigo', isDefault: false });
  }
  if (!open && initialisedFor !== null) setInitialisedFor(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (!form.name.trim()) found.name = 'Give the account a name.';
    if (form.openingBalance && parseAmount(form.openingBalance, user.currency) === null) {
      found.openingBalance = 'That is not a valid amount.';
    }
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }

    const payload = {
      name: form.name.trim(),
      type: form.type,
      institution: form.institution.trim() || null,
      openingBalance: form.openingBalance || '0',
      color: form.color,
      icon: ACCOUNT_TYPES.find((item) => item.value === form.type)?.icon ?? 'wallet',
      isDefault: form.isDefault,
    };

    try {
      if (account) {
        await updateMutation.mutateAsync({ id: account.id, patch: payload });
        toast.success('Account updated');
      } else {
        await createMutation.mutateAsync(payload);
        toast.success('Account created');
      }
      onClose();
    } catch (error) {
      if (error instanceof AppError) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of error.details) fieldErrors[issue.field] = issue.message;
        setErrors(fieldErrors);
        toast.error(error.message);
      }
    }
  }

  const pending = createMutation.isPending || updateMutation.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit account' : 'New account'}
      description={isEdit ? undefined : 'Somewhere you keep money — a bank, cash, a wallet.'}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Input
          label="Name"
          required
          data-autofocus
          placeholder="HDFC Bank, Cash, Paytm…"
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          error={errors.name}
          maxLength={60}
        />

        <Select
          label="Type"
          options={ACCOUNT_TYPES.map((item) => ({ value: item.value, label: item.label }))}
          value={form.type}
          onChange={(event) => setForm({ ...form, type: event.target.value as AccountType })}
        />

        <Input
          label="Bank or provider"
          placeholder="Optional"
          value={form.institution}
          onChange={(event) => setForm({ ...form, institution: event.target.value })}
          maxLength={80}
        />

        <AmountInput
          currency={user.currency}
          label="Opening balance"
          hint={
            isEdit
              ? 'Changing this shifts every balance derived from this account.'
              : 'What is in it right now. Leave blank for zero.'
          }
          value={form.openingBalance}
          onChange={(event) => setForm({ ...form, openingBalance: event.target.value })}
          error={errors.openingBalance}
        />

        <div>
          <span className="mb-2 block text-sm font-medium text-ink">Colour</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Account colour">
            {COLOR_TOKENS.map((color) => (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={form.color === color}
                aria-label={color}
                onClick={() => setForm({ ...form, color })}
                className={cn(
                  'h-7 w-7 rounded-full transition-transform',
                  swatch(color).dot,
                  form.color === color ? 'scale-110 ring-2 ring-ink ring-offset-2 ring-offset-surface' : 'hover:scale-105',
                )}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" loading={pending}>{isEdit ? 'Save changes' : 'Create account'}</Button>
        </div>
      </form>
    </Modal>
  );
}
