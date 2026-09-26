import { useState } from 'react';
import { CalendarClock, Pause, Pencil, Play, Plus, Repeat, Trash2, Zap } from 'lucide-react';
import { cn } from '@/lib/cn';
import { AppError } from '@/lib/errors';
import { formatMoney, parseAmount, toAmountInput } from '@/lib/money';
import { todayKey } from '@/lib/dates';
import { useCurrentUser } from '@/contexts/ProfileContext';
import { useToast } from '@/contexts/ToastContext';
import {
  useAccounts, useCategories, useCreateRecurring, useDeleteRecurring, useRecurring,
  useRunRecurring, useSubscriptions, useUpdateRecurring,
} from '@/hooks/queries';
import type { RecurringPayload } from '@/hooks/queries';
import { PageHeader } from '@/layouts/AppShell';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { AmountInput, Input, Segmented, Select, Switch } from '@/components/ui/Field';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState, RowSkeleton } from '@/components/ui/Skeleton';
import { IconTile } from '@/components/Icon';
import type { Frequency, Recurring } from '@/types/api';

const FREQUENCY_LABEL: Record<Frequency, string> = {
  daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly',
};

export function RecurringPage() {
  const user = useCurrentUser();
  const toast = useToast();
  const [tab, setTab] = useState<'all' | 'subscriptions'>('all');
  const { data: items = [], isLoading, isError, refetch } = useRecurring(false, true);
  const { data: subscriptions } = useSubscriptions();
  const [editing, setEditing] = useState<Recurring | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Recurring | null>(null);

  const updateMutation = useUpdateRecurring();
  const deleteMutation = useDeleteRecurring();
  const runMutation = useRunRecurring();

  const visible = tab === 'subscriptions' ? items.filter((item) => item.isSubscription) : items;

  return (
    <>
      <PageHeader
        title="Recurring & subscriptions"
        description="Things that happen on a schedule, posted for you automatically."
        action={
          <Button onClick={() => setCreating(true)} leftIcon={<Plus className="h-4 w-4" aria-hidden />}>
            New schedule
          </Button>
        }
      >
        <Segmented
          ariaLabel="View"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'all', label: 'All recurring' },
            { value: 'subscriptions', label: 'Subscriptions' },
          ]}
        />
      </PageHeader>

      {tab === 'subscriptions' && subscriptions && subscriptions.activeCount > 0 && (
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card className="p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-2">Per month</p>
            <p className="tnum mt-1.5 text-2xl font-bold text-ink">
              {formatMoney(subscriptions.monthlyTotalMinor, user.currency)}
            </p>
          </Card>
          <Card className="p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-2">Per year</p>
            <p className="tnum mt-1.5 text-2xl font-bold text-ink">
              {formatMoney(subscriptions.yearlyTotalMinor, user.currency)}
            </p>
          </Card>
          <Card className="p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-2">Active subscriptions</p>
            <p className="tnum mt-1.5 text-2xl font-bold text-ink">{subscriptions.activeCount}</p>
          </Card>
        </div>
      )}

      {isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : isLoading ? (
        <Card><RowSkeleton count={4} /></Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Repeat className="h-6 w-6" aria-hidden />}
            title={tab === 'subscriptions' ? 'No subscriptions tracked' : 'Nothing recurring yet'}
            description="Add your salary, rent, bills and subscriptions once — they will be recorded on schedule from then on."
            action={<Button onClick={() => setCreating(true)}>Add a schedule</Button>}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {visible.map((item) => {
              const due = item.nextRunOn !== null && item.nextRunOn <= todayKey();
              return (
                <li key={item.id} className={cn('p-4 sm:px-5', !item.isActive && 'opacity-55')}>
                  <div className="flex items-start gap-3">
                    <IconTile
                      icon={item.category?.icon ?? 'repeat'}
                      color={item.category?.color ?? 'slate'}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="truncate font-semibold text-ink">{item.description}</p>
                        {item.isSubscription && <Badge tone="brand">Subscription</Badge>}
                        {!item.isActive && <Badge>Paused</Badge>}
                        {due && item.isActive && <Badge tone="caution">Due now</Badge>}
                      </div>
                      <p className="mt-0.5 text-xs text-ink-2">
                        {FREQUENCY_LABEL[item.frequency]}
                        {item.intervalCount > 1 ? ` (every ${item.intervalCount})` : ''}
                        {' · '}
                        {item.category?.name ?? 'Transfer'} · {item.account.name}
                        {item.merchant ? ` · ${item.merchant}` : ''}
                      </p>
                      <p className="mt-1 text-xs text-ink-3">
                        {item.nextRunOn ? `Next on ${item.nextRunOn}` : 'No further occurrences'}
                        {item.isSubscription && item.frequency !== 'monthly' &&
                          ` · ${formatMoney(item.monthlyEquivalentMinor, user.currency)}/month equivalent`}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={cn('tnum font-semibold', item.type === 'income' ? 'text-positive' : 'text-ink')}>
                        {item.type === 'income' ? '+' : item.type === 'expense' ? '−' : ''}
                        {formatMoney(item.amountMinor, user.currency)}
                      </p>
                      <p className="text-xs text-ink-3">{item.autoPost ? 'Automatic' : 'Manual'}</p>
                    </div>
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-1">
                    {due && item.isActive && (
                      <Button
                        size="sm"
                        leftIcon={<Zap className="h-3.5 w-3.5" aria-hidden />}
                        loading={runMutation.isPending}
                        onClick={() =>
                          runMutation.mutate(item.id, {
                            onSuccess: (result) =>
                              toast.success(
                                result.posted > 0
                                  ? `Posted ${result.posted} ${result.posted === 1 ? 'entry' : 'entries'}`
                                  : 'Already up to date',
                              ),
                          })
                        }
                      >
                        Post now
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={item.isActive ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
                      onClick={() =>
                        updateMutation.mutate(
                          { id: item.id, patch: { isActive: !item.isActive } },
                          { onSuccess: () => toast.success(item.isActive ? 'Paused' : 'Resumed') },
                        )
                      }
                    >
                      {item.isActive ? 'Pause' : 'Resume'}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(item)} leftIcon={<Pencil className="h-3.5 w-3.5" aria-hidden />}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto text-negative hover:bg-negative-soft"
                      onClick={() => setDeleting(item)}
                      aria-label="Delete schedule"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {subscriptions && subscriptions.upcoming.length > 0 && (
        <Card className="mt-4">
          <CardHeader title="Upcoming payments" subtitle="The next few scheduled entries" />
          <ul className="divide-y divide-line">
            {subscriptions.upcoming.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-5 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-3 text-ink-2" aria-hidden>
                  <CalendarClock className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{item.description}</span>
                  <span className="block text-xs text-ink-2">{item.nextRunOn}</span>
                </span>
                <span className="tnum text-sm font-semibold text-ink">
                  {formatMoney(item.amountMinor, user.currency)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <RecurringFormModal
        open={creating || editing !== null}
        item={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await deleteMutation.mutateAsync(deleting.id);
            toast.success('Schedule deleted');
          } catch {
            toast.error('That could not be deleted.');
          }
          setDeleting(null);
        }}
        title="Delete this schedule?"
        message={`"${deleting?.description}" will stop recurring. Transactions it already created stay in your history.`}
        confirmLabel="Delete schedule"
        loading={deleteMutation.isPending}
      />
    </>
  );
}

function RecurringFormModal({
  open, item, onClose,
}: {
  open: boolean;
  item: Recurring | null;
  onClose: () => void;
}) {
  const user = useCurrentUser();
  const toast = useToast();
  const { data: accountData } = useAccounts();
  const { data: expenseCategories = [] } = useCategories('expense');
  const { data: incomeCategories = [] } = useCategories('income');
  const createMutation = useCreateRecurring();
  const updateMutation = useUpdateRecurring();

  const accounts = accountData?.accounts ?? [];

  const [form, setForm] = useState({
    type: 'expense' as 'income' | 'expense' | 'transfer',
    amount: '', accountId: '', toAccountId: '', categoryId: '', description: '',
    frequency: 'monthly' as Frequency, intervalCount: 1, startDate: todayKey(), endDate: '',
    isSubscription: false, merchant: '', autoPost: true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [initialisedFor, setInitialisedFor] = useState<string | null>(null);

  const categories = form.type === 'income' ? incomeCategories : expenseCategories;

  if (open && item && initialisedFor !== item.id) {
    setInitialisedFor(item.id);
    setForm({
      type: item.type,
      amount: toAmountInput(item.amountMinor, user.currency),
      accountId: item.account.id,
      toAccountId: item.toAccount?.id ?? '',
      categoryId: item.category?.id ?? '',
      description: item.description,
      frequency: item.frequency,
      intervalCount: item.intervalCount,
      startDate: item.startDate,
      endDate: item.endDate ?? '',
      isSubscription: item.isSubscription,
      merchant: item.merchant ?? '',
      autoPost: item.autoPost,
    });
  }
  if (open && !item && initialisedFor !== 'new') {
    setInitialisedFor('new');
    setForm({
      type: 'expense', amount: '',
      accountId: (accounts.find((account) => account.isDefault) ?? accounts[0])?.id ?? '',
      toAccountId: '', categoryId: '', description: '', frequency: 'monthly', intervalCount: 1,
      startDate: todayKey(), endDate: '', isSubscription: false, merchant: '', autoPost: true,
    });
  }
  if (!open && initialisedFor !== null) setInitialisedFor(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (!form.description.trim()) found.description = 'Add a description.';
    const amount = parseAmount(form.amount, user.currency);
    if (amount === null || amount <= 0) found.amount = 'Enter an amount.';
    if (!form.accountId) found.accountId = 'Choose an account.';
    if (form.type === 'transfer' && !form.toAccountId) found.toAccountId = 'Choose a destination.';
    if (form.type !== 'transfer' && !form.categoryId) found.categoryId = 'Choose a category.';
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }

    const payload: RecurringPayload = {
      type: form.type,
      amount: form.amount,
      accountId: form.accountId,
      toAccountId: form.type === 'transfer' ? form.toAccountId : null,
      categoryId: form.type === 'transfer' ? null : form.categoryId,
      description: form.description.trim(),
      frequency: form.frequency,
      intervalCount: form.intervalCount,
      startDate: form.startDate,
      endDate: form.endDate || null,
      isSubscription: form.isSubscription,
      merchant: form.merchant.trim() || null,
      autoPost: form.autoPost,
    };

    try {
      if (item) {
        await updateMutation.mutateAsync({ id: item.id, patch: payload });
        toast.success('Schedule updated');
      } else {
        await createMutation.mutateAsync(payload);
        toast.success('Schedule created');
      }
      onClose();
    } catch (error) {
      toast.error(error instanceof AppError ? error.message : 'That did not save.');
    }
  }

  const pending = createMutation.isPending || updateMutation.isPending;

  return (
    <Modal open={open} onClose={onClose} title={item ? 'Edit schedule' : 'New recurring transaction'} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Segmented
          ariaLabel="Type"
          value={form.type}
          onChange={(type) => setForm({ ...form, type, categoryId: '', toAccountId: '' })}
          options={[
            { value: 'expense', label: 'Expense' },
            { value: 'income', label: 'Income' },
            { value: 'transfer', label: 'Transfer' },
          ]}
          className="w-full"
        />

        <AmountInput
          currency={user.currency}
          label="Amount"
          required
          data-autofocus
          value={form.amount}
          onChange={(event) => setForm({ ...form, amount: event.target.value })}
          error={errors.amount}
        />

        <Input
          label="Description"
          required
          placeholder="Monthly rent, Netflix, salary…"
          value={form.description}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
          error={errors.description}
          maxLength={140}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label={form.type === 'transfer' ? 'From account' : 'Account'}
            required
            options={accounts.map((account) => ({ value: account.id, label: account.name }))}
            value={form.accountId}
            onChange={(event) => setForm({ ...form, accountId: event.target.value })}
            error={errors.accountId}
          />
          {form.type === 'transfer' ? (
            <Select
              label="To account"
              required
              options={accounts
                .filter((account) => account.id !== form.accountId)
                .map((account) => ({ value: account.id, label: account.name }))}
              value={form.toAccountId}
              onChange={(event) => setForm({ ...form, toAccountId: event.target.value })}
              error={errors.toAccountId}
            />
          ) : (
            <Select
              label="Category"
              required
              placeholder="Choose…"
              options={categories.map((category) => ({ value: category.id, label: category.name }))}
              value={form.categoryId}
              onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
              error={errors.categoryId}
            />
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select
            label="Repeats"
            options={Object.entries(FREQUENCY_LABEL).map(([value, label]) => ({ value, label }))}
            value={form.frequency}
            onChange={(event) => setForm({ ...form, frequency: event.target.value as Frequency })}
          />
          <Input
            label="Every"
            type="number"
            min={1}
            max={52}
            hint={`${form.frequency.replace('ly', '')}(s)`}
            value={String(form.intervalCount)}
            onChange={(event) => setForm({ ...form, intervalCount: Math.max(1, Number(event.target.value) || 1) })}
          />
          <Input
            label="Starts"
            type="date"
            value={form.startDate}
            onChange={(event) => setForm({ ...form, startDate: event.target.value })}
          />
        </div>

        <Input
          label="Ends"
          type="date"
          hint="Optional — leave blank to repeat indefinitely."
          value={form.endDate}
          onChange={(event) => setForm({ ...form, endDate: event.target.value })}
        />

        <div className="space-y-3 rounded-xl border border-line p-3.5">
          <Switch
            checked={form.autoPost}
            onChange={(autoPost) => setForm({ ...form, autoPost })}
            label="Record it automatically"
            description="When off, it appears as due and you post it with one tap."
          />
          <Switch
            checked={form.isSubscription}
            onChange={(isSubscription) => setForm({ ...form, isSubscription })}
            label="This is a subscription"
            description="Included in your monthly and yearly subscription totals."
          />
          {form.isSubscription && (
            <Input
              label="Provider"
              placeholder="Netflix, Airtel…"
              value={form.merchant}
              onChange={(event) => setForm({ ...form, merchant: event.target.value })}
              maxLength={80}
            />
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" loading={pending}>{item ? 'Save changes' : 'Create schedule'}</Button>
        </div>
      </form>
    </Modal>
  );
}
