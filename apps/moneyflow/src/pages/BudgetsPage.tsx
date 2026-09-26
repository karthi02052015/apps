import { useState } from 'react';
import { AlertTriangle, Pencil, PieChart, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { AppError } from '@/lib/errors';
import { formatBps, formatMoney, parseAmount, toAmountInput } from '@/lib/money';
import { rangeLabel } from '@/lib/dates';
import { useCurrentUser } from '@/contexts/ProfileContext';
import { useToast } from '@/contexts/ToastContext';
import { useBudgets, useCategories, useCreateBudget, useDeleteBudget, useUpdateBudget } from '@/hooks/queries';
import { PageHeader } from '@/layouts/AppShell';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Progress } from '@/components/ui/Progress';
import { AmountInput, Input, Select } from '@/components/ui/Field';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState, StatSkeleton } from '@/components/ui/Skeleton';
import { CategoryBadge } from '@/components/ui/Badge';
import { COLOR_TOKENS, swatch } from '@/lib/tokens';
import type { Budget } from '@/types/api';

export function BudgetsPage() {
  const user = useCurrentUser();
  const toast = useToast();
  const { data: budgets = [], isLoading, isError, refetch } = useBudgets();
  const [editing, setEditing] = useState<Budget | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Budget | null>(null);
  const deleteMutation = useDeleteBudget();

  const warnings = budgets.filter((budget) => budget.status !== 'on_track');

  return (
    <>
      <PageHeader
        title="Budgets"
        description="Set a limit, then watch it as the month goes on."
        action={
          <Button onClick={() => setCreating(true)} leftIcon={<Plus className="h-4 w-4" aria-hidden />}>
            New budget
          </Button>
        }
      />

      {warnings.length > 0 && (
        <div className="mb-4 space-y-2">
          {warnings.map((budget) => (
            <div
              key={budget.id}
              className={cn(
                'flex items-start gap-3 rounded-xl border px-4 py-3 text-sm',
                budget.status === 'exceeded'
                  ? 'border-negative/25 bg-negative-soft text-negative'
                  : 'border-caution/25 bg-caution-soft text-caution',
              )}
              role="status"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>
                {budget.status === 'exceeded' ? (
                  <>
                    You are <strong className="font-semibold">{formatMoney(budget.spentMinor - budget.limitMinor, user.currency)} over</strong>{' '}
                    your {budget.name} budget.
                  </>
                ) : (
                  <>
                    You&apos;ve used <strong className="font-semibold">{formatBps(budget.usedBps)}</strong> of your{' '}
                    {budget.name} budget — {formatMoney(budget.remainingMinor, user.currency)} left with{' '}
                    {budget.daysRemaining} {budget.daysRemaining === 1 ? 'day' : 'days'} to go.
                  </>
                )}
              </p>
            </div>
          ))}
        </div>
      )}

      {isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => <StatSkeleton key={index} />)}
        </div>
      ) : budgets.length === 0 ? (
        <Card>
          <EmptyState
            icon={<PieChart className="h-6 w-6" aria-hidden />}
            title="No budgets yet"
            description="Pick a category and a monthly limit. We will keep track of how much is left."
            action={<Button onClick={() => setCreating(true)}>Create your first budget</Button>}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {budgets.map((budget) => (
            <Card key={budget.id} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold text-ink">{budget.name}</h3>
                  <p className="mt-0.5 text-xs capitalize text-ink-2">
                    {budget.period} · {rangeLabel(budget.periodStart, budget.periodEnd)}
                  </p>
                </div>
                <Badge
                  tone={budget.status === 'exceeded' ? 'negative' : budget.status === 'warning' ? 'caution' : 'positive'}
                >
                  {budget.status === 'exceeded' ? 'Over' : budget.status === 'warning' ? 'Close' : 'On track'}
                </Badge>
              </div>

              <div className="mt-4">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="tnum text-2xl font-bold tracking-tight text-ink">
                    {formatMoney(budget.spentMinor, user.currency)}
                  </span>
                  <span className="tnum text-sm text-ink-2">
                    of {formatMoney(budget.limitMinor, user.currency)}
                  </span>
                </div>
                <Progress
                  valueBps={budget.usedBps}
                  className="mt-2"
                  tone={budget.status === 'exceeded' ? 'negative' : budget.status === 'warning' ? 'caution' : 'positive'}
                  label={`${budget.name} budget`}
                />
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className={cn('font-medium', budget.remainingMinor < 0 ? 'text-negative' : 'text-positive')}>
                    {budget.remainingMinor < 0
                      ? `${formatMoney(-budget.remainingMinor, user.currency)} over`
                      : `${formatMoney(budget.remainingMinor, user.currency)} left`}
                  </span>
                  <span className="text-ink-2">{formatBps(budget.usedBps)} used</span>
                </div>
                {budget.safeDailyMinor > 0 && (
                  <p className="mt-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-ink-2">
                    {formatMoney(budget.safeDailyMinor, user.currency)} a day keeps you within it.
                  </p>
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-1.5">
                {budget.categories.map((category) => (
                  <CategoryBadge key={category.id} name={category.name} color={category.color} />
                ))}
              </div>

              <div className="mt-auto flex gap-1 pt-4">
                <Button variant="ghost" size="sm" onClick={() => setEditing(budget)} leftIcon={<Pencil className="h-3.5 w-3.5" aria-hidden />}>
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-negative hover:bg-negative-soft"
                  onClick={() => setDeleting(budget)}
                  aria-label="Delete budget"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <BudgetFormModal
        open={creating || editing !== null}
        budget={editing}
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
            toast.success('Budget deleted');
          } catch {
            toast.error('That could not be deleted.');
          }
          setDeleting(null);
        }}
        title="Delete this budget?"
        message={`"${deleting?.name}" will be removed. Your transactions are not affected.`}
        confirmLabel="Delete budget"
        loading={deleteMutation.isPending}
      />
    </>
  );
}

function BudgetFormModal({
  open, budget, onClose,
}: {
  open: boolean;
  budget: Budget | null;
  onClose: () => void;
}) {
  const user = useCurrentUser();
  const toast = useToast();
  const { data: categories = [] } = useCategories('expense');
  const createMutation = useCreateBudget();
  const updateMutation = useUpdateBudget();

  const [form, setForm] = useState({
    name: '', period: 'monthly', limit: '', alertThresholdPct: 80, color: 'indigo',
    categoryIds: [] as string[],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [initialisedFor, setInitialisedFor] = useState<string | null>(null);

  if (open && budget && initialisedFor !== budget.id) {
    setInitialisedFor(budget.id);
    setForm({
      name: budget.name,
      period: budget.period,
      limit: toAmountInput(budget.limitMinor, user.currency),
      alertThresholdPct: budget.alertThresholdPct,
      color: budget.color,
      categoryIds: budget.categories.map((category) => category.id),
    });
  }
  if (open && !budget && initialisedFor !== 'new') {
    setInitialisedFor('new');
    setForm({ name: '', period: 'monthly', limit: '', alertThresholdPct: 80, color: 'indigo', categoryIds: [] });
  }
  if (!open && initialisedFor !== null) setInitialisedFor(null);

  const toggleCategory = (id: string) =>
    setForm((current) => ({
      ...current,
      categoryIds: current.categoryIds.includes(id)
        ? current.categoryIds.filter((item) => item !== id)
        : [...current.categoryIds, id],
    }));

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (!form.name.trim()) found.name = 'Give the budget a name.';
    const limit = parseAmount(form.limit, user.currency);
    if (limit === null || limit <= 0) found.limit = 'Enter a spending limit.';
    if (form.categoryIds.length === 0) found.categoryIds = 'Choose at least one category.';
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }

    const payload = {
      name: form.name.trim(),
      period: form.period,
      limit: form.limit,
      alertThresholdPct: form.alertThresholdPct,
      color: form.color,
      categoryIds: form.categoryIds,
    };

    try {
      if (budget) {
        await updateMutation.mutateAsync({ id: budget.id, patch: payload });
        toast.success('Budget updated');
      } else {
        await createMutation.mutateAsync(payload);
        toast.success('Budget created');
      }
      onClose();
    } catch (error) {
      toast.error(error instanceof AppError ? error.message : 'That did not save.');
    }
  }

  const pending = createMutation.isPending || updateMutation.isPending;

  return (
    <Modal open={open} onClose={onClose} title={budget ? 'Edit budget' : 'New budget'} size="md">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Input
          label="Name"
          required
          data-autofocus
          placeholder="Food & dining"
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          error={errors.name}
          maxLength={60}
        />

        <div className="grid grid-cols-2 gap-3">
          <AmountInput
            currency={user.currency}
            label="Limit"
            required
            value={form.limit}
            onChange={(event) => setForm({ ...form, limit: event.target.value })}
            error={errors.limit}
          />
          <Select
            label="Resets"
            options={[
              { value: 'weekly', label: 'Every week' },
              { value: 'monthly', label: 'Every month' },
              { value: 'yearly', label: 'Every year' },
            ]}
            value={form.period}
            onChange={(event) => setForm({ ...form, period: event.target.value })}
          />
        </div>

        <div>
          <label htmlFor="threshold" className="mb-1.5 block text-sm font-medium text-ink">
            Warn me at {form.alertThresholdPct}%
          </label>
          <input
            id="threshold"
            type="range"
            min={50}
            max={100}
            step={5}
            value={form.alertThresholdPct}
            onChange={(event) => setForm({ ...form, alertThresholdPct: Number(event.target.value) })}
            className="w-full accent-brand"
          />
        </div>

        <div>
          <span className="mb-2 block text-sm font-medium text-ink">
            Categories<span className="ml-0.5 text-negative" aria-hidden>*</span>
          </span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Budget categories">
            {categories.map((category) => {
              const active = form.categoryIds.includes(category.id);
              return (
                <button
                  key={category.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleCategory(category.id)}
                  className={cn(
                    'rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all',
                    active
                      ? 'border-brand bg-brand-soft text-brand-ink'
                      : 'border-line bg-surface text-ink-2 hover:border-ink-3',
                  )}
                >
                  {category.name}
                </button>
              );
            })}
          </div>
          {errors.categoryIds && <p className="mt-1.5 text-xs font-medium text-negative">{errors.categoryIds}</p>}
        </div>

        <div>
          <span className="mb-2 block text-sm font-medium text-ink">Colour</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Budget colour">
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
          <Button type="submit" loading={pending}>{budget ? 'Save changes' : 'Create budget'}</Button>
        </div>
      </form>
    </Modal>
  );
}
