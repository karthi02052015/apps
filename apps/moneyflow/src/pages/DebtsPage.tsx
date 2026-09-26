import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Handshake, Pencil, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { AppError } from '@/lib/errors';
import { formatBps, formatMoney, parseAmount, toAmountInput } from '@/lib/money';
import { useCurrentUser } from '@/contexts/ProfileContext';
import { useToast } from '@/contexts/ToastContext';
import { useCreateDebt, useDebts, useDeleteDebt, useUpdateDebt } from '@/hooks/queries';
import { PageHeader } from '@/layouts/AppShell';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Progress } from '@/components/ui/Progress';
import { AmountInput, Input, Segmented, Textarea } from '@/components/ui/Field';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState, RowSkeleton } from '@/components/ui/Skeleton';
import { DebtPaymentForm } from '@/components/DebtPaymentForm';
import type { Debt, DebtDirection } from '@/types/api';

const STATUS_TONE = {
  pending: 'neutral',
  partially_paid: 'caution',
  paid: 'positive',
  written_off: 'neutral',
} as const;

const STATUS_LABEL = {
  pending: 'Pending',
  partially_paid: 'Partly paid',
  paid: 'Settled',
  written_off: 'Written off',
} as const;

export function DebtsPage() {
  const user = useCurrentUser();
  const toast = useToast();
  const [direction, setDirection] = useState<'all' | DebtDirection>('all');
  const { data, isLoading, isError, refetch } = useDebts(direction === 'all' ? undefined : direction);
  const [editing, setEditing] = useState<Debt | null>(null);
  const [creating, setCreating] = useState(false);
  const [repaying, setRepaying] = useState<Debt | null>(null);
  const [deleting, setDeleting] = useState<Debt | null>(null);
  const deleteMutation = useDeleteDebt();

  const debts = data?.debts ?? [];
  const totals = data?.totals;

  return (
    <>
      <PageHeader
        title="Debts & loans"
        description="Money you owe, and money owed to you."
        action={
          <Button onClick={() => setCreating(true)} leftIcon={<Plus className="h-4 w-4" aria-hidden />}>
            New record
          </Button>
        }
      >
        <Segmented
          ariaLabel="Filter by direction"
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'all', label: 'Everything' },
            { value: 'i_owe', label: 'I owe' },
            { value: 'owed_to_me', label: 'Owed to me' },
          ]}
        />
      </PageHeader>

      {totals && (
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card className="p-5">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">
              <ArrowUpRight className="h-3.5 w-3.5 text-negative" aria-hidden />
              You owe
            </p>
            <p className="tnum mt-1.5 text-2xl font-bold text-negative">
              {formatMoney(totals.iOweMinor, user.currency)}
            </p>
            <p className="mt-1 text-xs text-ink-2">
              across {totals.iOweCount} {totals.iOweCount === 1 ? 'record' : 'records'}
            </p>
          </Card>
          <Card className="p-5">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">
              <ArrowDownLeft className="h-3.5 w-3.5 text-positive" aria-hidden />
              Owed to you
            </p>
            <p className="tnum mt-1.5 text-2xl font-bold text-positive">
              {formatMoney(totals.owedToMeMinor, user.currency)}
            </p>
            <p className="mt-1 text-xs text-ink-2">
              across {totals.owedToMeCount} {totals.owedToMeCount === 1 ? 'record' : 'records'}
            </p>
          </Card>
        </div>
      )}

      {isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : isLoading ? (
        <Card><RowSkeleton count={3} /></Card>
      ) : debts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Handshake className="h-6 w-6" aria-hidden />}
            title="Nothing recorded"
            description="Keep track of money lent to friends or borrowed from family, and record repayments as they happen."
            action={<Button onClick={() => setCreating(true)}>Add a record</Button>}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {debts.map((debt) => (
            <Card key={debt.id} className="p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className={cn(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                      debt.direction === 'i_owe' ? 'bg-negative-soft text-negative' : 'bg-positive-soft text-positive',
                    )}
                    aria-hidden
                  >
                    {debt.direction === 'i_owe' ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownLeft className="h-5 w-5" />}
                  </span>
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold text-ink">{debt.counterparty}</h3>
                    <p className="mt-0.5 text-xs text-ink-2">
                      {debt.direction === 'i_owe' ? 'You owe them' : 'They owe you'}
                      {debt.dueDate && ` · due ${debt.dueDate}`}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge tone={STATUS_TONE[debt.status]}>{STATUS_LABEL[debt.status]}</Badge>
                  {debt.isOverdue && <Badge tone="negative">Overdue</Badge>}
                </div>
              </div>

              <div className="mt-4">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="tnum text-2xl font-bold tracking-tight text-ink">
                    {formatMoney(debt.outstandingMinor, user.currency)}
                  </span>
                  <span className="tnum text-sm text-ink-2">
                    of {formatMoney(debt.principalMinor, user.currency)}
                  </span>
                </div>
                <Progress
                  valueBps={debt.progressBps}
                  className="mt-2"
                  tone={debt.status === 'paid' ? 'positive' : 'brand'}
                  label={`${debt.counterparty} repayment progress`}
                />
                <p className="mt-2 text-xs text-ink-2">
                  {formatMoney(debt.paidMinor, user.currency)} repaid ({formatBps(debt.progressBps)})
                </p>
              </div>

              {debt.description && <p className="mt-3 text-sm text-ink-2">{debt.description}</p>}

              <div className="mt-4 flex items-center gap-1">
                {debt.outstandingMinor > 0 && !debt.isWrittenOff && (
                  <Button size="sm" onClick={() => setRepaying(debt)} leftIcon={<Plus className="h-3.5 w-3.5" aria-hidden />}>
                    Record repayment
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setEditing(debt)} aria-label="Edit record">
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-negative hover:bg-negative-soft"
                  onClick={() => setDeleting(debt)}
                  aria-label="Delete record"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <DebtFormModal
        open={creating || editing !== null}
        debt={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />

      <Modal
        open={repaying !== null}
        onClose={() => setRepaying(null)}
        title={`Repayment · ${repaying?.counterparty ?? ''}`}
        size="md"
      >
        {repaying && (
          <DebtPaymentForm
            initialDebtId={repaying.id}
            onDone={() => setRepaying(null)}
            onCancel={() => setRepaying(null)}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await deleteMutation.mutateAsync(deleting.id);
            toast.success('Record deleted');
          } catch {
            toast.error('That could not be deleted.');
          }
          setDeleting(null);
        }}
        title="Delete this record?"
        message={`The debt with ${deleting?.counterparty} and its repayment history will be removed. Linked transactions stay in your ledger.`}
        confirmLabel="Delete record"
        loading={deleteMutation.isPending}
      />
    </>
  );
}

function DebtFormModal({ open, debt, onClose }: { open: boolean; debt: Debt | null; onClose: () => void }) {
  const user = useCurrentUser();
  const toast = useToast();
  const createMutation = useCreateDebt();
  const updateMutation = useUpdateDebt();

  const [form, setForm] = useState({
    direction: 'i_owe' as DebtDirection,
    counterparty: '', amount: '', description: '', dueDate: '', isWrittenOff: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [initialisedFor, setInitialisedFor] = useState<string | null>(null);

  if (open && debt && initialisedFor !== debt.id) {
    setInitialisedFor(debt.id);
    setForm({
      direction: debt.direction,
      counterparty: debt.counterparty,
      amount: toAmountInput(debt.principalMinor, user.currency),
      description: debt.description ?? '',
      dueDate: debt.dueDate ?? '',
      isWrittenOff: debt.isWrittenOff ?? false,
    });
  }
  if (open && !debt && initialisedFor !== 'new') {
    setInitialisedFor('new');
    setForm({ direction: 'i_owe', counterparty: '', amount: '', description: '', dueDate: '', isWrittenOff: false });
  }
  if (!open && initialisedFor !== null) setInitialisedFor(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (!form.counterparty.trim()) found.counterparty = 'Who is this with?';
    const amount = parseAmount(form.amount, user.currency);
    if (amount === null || amount <= 0) found.amount = 'Enter an amount.';
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }

    const payload = {
      direction: form.direction,
      counterparty: form.counterparty.trim(),
      amount: form.amount,
      description: form.description.trim() || null,
      dueDate: form.dueDate || null,
    };

    try {
      if (debt) {
        await updateMutation.mutateAsync({ id: debt.id, patch: payload });
        toast.success('Record updated');
      } else {
        await createMutation.mutateAsync(payload);
        toast.success('Record created');
      }
      onClose();
    } catch (error) {
      toast.error(error instanceof AppError ? error.message : 'That did not save.');
    }
  }

  const pending = createMutation.isPending || updateMutation.isPending;

  return (
    <Modal open={open} onClose={onClose} title={debt ? 'Edit record' : 'New debt record'} size="md">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Segmented
          ariaLabel="Direction"
          value={form.direction}
          onChange={(direction) => setForm({ ...form, direction })}
          options={[
            { value: 'i_owe', label: 'I owe' },
            { value: 'owed_to_me', label: 'Owed to me' },
          ]}
          className="w-full"
        />
        <Input
          label="Person or organisation"
          required
          data-autofocus
          placeholder="Ravi, HDFC, the office…"
          value={form.counterparty}
          onChange={(event) => setForm({ ...form, counterparty: event.target.value })}
          error={errors.counterparty}
          maxLength={80}
        />
        <AmountInput
          currency={user.currency}
          label="Amount"
          required
          value={form.amount}
          onChange={(event) => setForm({ ...form, amount: event.target.value })}
          error={errors.amount}
        />
        <Input
          label="Due date"
          type="date"
          hint="Optional — we will remind you as it approaches."
          value={form.dueDate}
          onChange={(event) => setForm({ ...form, dueDate: event.target.value })}
        />
        <Textarea
          label="What is it for?"
          placeholder="Optional"
          value={form.description}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
          maxLength={500}
        />
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" loading={pending}>{debt ? 'Save changes' : 'Create record'}</Button>
        </div>
      </form>
    </Modal>
  );
}
