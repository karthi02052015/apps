import { useState } from 'react';
import { CheckCircle2, Pencil, Plus, Target, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { AppError } from '@/lib/errors';
import { formatBps, formatMoney, parseAmount, toAmountInput } from '@/lib/money';
import { useCurrentUser } from '@/contexts/ProfileContext';
import { useToast } from '@/contexts/ToastContext';
import type { GoalPayload } from '@/hooks/queries';
import { useCreateGoal, useDeleteGoal, useGoals, useUpdateGoal } from '@/hooks/queries';
import { PageHeader } from '@/layouts/AppShell';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Progress } from '@/components/ui/Progress';
import { AmountInput, Input, Textarea } from '@/components/ui/Field';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState, StatSkeleton } from '@/components/ui/Skeleton';
import { GoalContributionForm } from '@/components/GoalContributionForm';
import { COLOR_TOKENS, swatch } from '@/lib/tokens';
import type { Goal } from '@/types/api';

export function GoalsPage() {
  const user = useCurrentUser();
  const toast = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const { data: goals = [], isLoading, isError, refetch } = useGoals(showArchived);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [creating, setCreating] = useState(false);
  const [contributing, setContributing] = useState<Goal | null>(null);
  const [deleting, setDeleting] = useState<Goal | null>(null);
  const deleteMutation = useDeleteGoal();

  const totalTarget = goals.reduce((sum, goal) => sum + goal.targetMinor, 0);
  const totalSaved = goals.reduce((sum, goal) => sum + goal.savedMinor, 0);

  return (
    <>
      <PageHeader
        title="Savings goals"
        description="What you are putting money aside for."
        action={
          <Button onClick={() => setCreating(true)} leftIcon={<Plus className="h-4 w-4" aria-hidden />}>
            New goal
          </Button>
        }
      />

      {goals.length > 0 && (
        <Card className="mb-4 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-2">Saved across all goals</p>
              <p className="tnum mt-1 text-2xl font-bold tracking-tight text-ink">
                {formatMoney(totalSaved, user.currency)}
              </p>
            </div>
            <p className="tnum text-sm text-ink-2">
              of {formatMoney(totalTarget, user.currency)} targeted
            </p>
          </div>
          <Progress
            valueBps={totalTarget > 0 ? Math.round((totalSaved * 10_000) / totalTarget) : 0}
            className="mt-3"
            tone="positive"
            label="Overall goal progress"
          />
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => <StatSkeleton key={index} />)}
        </div>
      ) : goals.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Target className="h-6 w-6" aria-hidden />}
            title="No savings goals yet"
            description="A goal gives your saving something concrete to aim at — a laptop, a trip, a safety net."
            action={<Button onClick={() => setCreating(true)}>Create your first goal</Button>}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {goals.map((goal) => {
            const achieved = goal.progressBps >= 10_000;
            return (
              <Card key={goal.id} className={cn('flex flex-col p-5', goal.status === 'archived' && 'opacity-60')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', swatch(goal.color).chip)}
                      aria-hidden
                    >
                      <Target className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold text-ink">{goal.name}</h3>
                      {goal.targetDate && (
                        <p className="mt-0.5 text-xs text-ink-2">
                          by {goal.targetDate}
                          {goal.daysRemaining !== null && goal.daysRemaining > 0 && ` · ${goal.daysRemaining} days`}
                        </p>
                      )}
                    </div>
                  </div>
                  {achieved && (
                    <Badge tone="positive" icon={<CheckCircle2 className="h-3 w-3" aria-hidden />}>Reached</Badge>
                  )}
                </div>

                <div className="mt-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="tnum text-2xl font-bold tracking-tight text-ink">
                      {formatMoney(goal.savedMinor, user.currency)}
                    </span>
                    <span className="tnum text-sm text-ink-2">of {formatMoney(goal.targetMinor, user.currency)}</span>
                  </div>
                  <Progress valueBps={goal.progressBps} className="mt-2" tone="positive" label={goal.name} />
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="font-medium text-positive">{formatBps(goal.progressBps)} there</span>
                    <span className="text-ink-2">{formatMoney(goal.remainingMinor, user.currency)} to go</span>
                  </div>
                  {goal.monthlyNeededMinor !== null && goal.monthlyNeededMinor > 0 && (
                    <p className="mt-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-ink-2">
                      {formatMoney(goal.monthlyNeededMinor, user.currency)} a month gets you there on time.
                    </p>
                  )}
                </div>

                {goal.description && <p className="mt-3 text-sm text-ink-2">{goal.description}</p>}

                <div className="mt-auto flex items-center gap-1 pt-4">
                  <Button size="sm" onClick={() => setContributing(goal)} leftIcon={<Plus className="h-3.5 w-3.5" aria-hidden />}>
                    Add money
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(goal)} aria-label="Edit goal">
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto text-negative hover:bg-negative-soft"
                    onClick={() => setDeleting(goal)}
                    aria-label="Delete goal"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <GoalFormModal
        open={creating || editing !== null}
        goal={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />

      <Modal
        open={contributing !== null}
        onClose={() => setContributing(null)}
        title={`Add to ${contributing?.name ?? 'goal'}`}
        size="md"
      >
        {contributing && (
          <GoalContributionForm
            initialGoalId={contributing.id}
            onDone={() => setContributing(null)}
            onCancel={() => setContributing(null)}
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
            toast.success('Goal deleted');
          } catch {
            toast.error('That could not be deleted.');
          }
          setDeleting(null);
        }}
        title="Delete this goal?"
        message={`"${deleting?.name}" and its contribution history will be removed. Your account balances are not affected.`}
        confirmLabel="Delete goal"
        loading={deleteMutation.isPending}
      />
    </>
  );
}

function GoalFormModal({ open, goal, onClose }: { open: boolean; goal: Goal | null; onClose: () => void }) {
  const user = useCurrentUser();
  const toast = useToast();
  const createMutation = useCreateGoal();
  const updateMutation = useUpdateGoal();

  const [form, setForm] = useState({
    name: '', target: '', initialSaved: '', targetDate: '', description: '', color: 'emerald',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [initialisedFor, setInitialisedFor] = useState<string | null>(null);

  if (open && goal && initialisedFor !== goal.id) {
    setInitialisedFor(goal.id);
    setForm({
      name: goal.name,
      target: toAmountInput(goal.targetMinor, user.currency),
      initialSaved: '',
      targetDate: goal.targetDate ?? '',
      description: goal.description ?? '',
      color: goal.color,
    });
  }
  if (open && !goal && initialisedFor !== 'new') {
    setInitialisedFor('new');
    setForm({ name: '', target: '', initialSaved: '', targetDate: '', description: '', color: 'emerald' });
  }
  if (!open && initialisedFor !== null) setInitialisedFor(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (!form.name.trim()) found.name = 'Give the goal a name.';
    const target = parseAmount(form.target, user.currency);
    if (target === null || target <= 0) found.target = 'Enter a target amount.';
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }

    const payload: GoalPayload = {
      name: form.name.trim(),
      target: form.target,
      description: form.description.trim() || null,
      color: form.color,
      targetDate: form.targetDate || null,
    };
    if (!goal && form.initialSaved) payload.initialSaved = form.initialSaved;

    try {
      if (goal) {
        await updateMutation.mutateAsync({ id: goal.id, patch: payload });
        toast.success('Goal updated');
      } else {
        await createMutation.mutateAsync(payload);
        toast.success('Goal created');
      }
      onClose();
    } catch (error) {
      toast.error(error instanceof AppError ? error.message : 'That did not save.');
    }
  }

  const pending = createMutation.isPending || updateMutation.isPending;

  return (
    <Modal open={open} onClose={onClose} title={goal ? 'Edit goal' : 'New savings goal'} size="md">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Input
          label="What are you saving for?"
          required
          data-autofocus
          placeholder="New laptop"
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          error={errors.name}
          maxLength={60}
        />
        <AmountInput
          currency={user.currency}
          label="Target amount"
          required
          value={form.target}
          onChange={(event) => setForm({ ...form, target: event.target.value })}
          error={errors.target}
        />
        {!goal && (
          <AmountInput
            currency={user.currency}
            label="Already saved"
            hint="Optional — what you have put aside so far."
            value={form.initialSaved}
            onChange={(event) => setForm({ ...form, initialSaved: event.target.value })}
          />
        )}
        <Input
          label="Target date"
          type="date"
          hint="Optional — we will work out the monthly amount."
          value={form.targetDate}
          onChange={(event) => setForm({ ...form, targetDate: event.target.value })}
        />
        <Textarea
          label="Notes"
          placeholder="Optional"
          value={form.description}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
          maxLength={500}
        />
        <div>
          <span className="mb-2 block text-sm font-medium text-ink">Colour</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Goal colour">
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
          <Button type="submit" loading={pending}>{goal ? 'Save changes' : 'Create goal'}</Button>
        </div>
      </form>
    </Modal>
  );
}
