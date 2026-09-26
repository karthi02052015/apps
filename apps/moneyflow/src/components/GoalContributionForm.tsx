import { useEffect, useState } from 'react';
import { AppError } from '@/lib/errors';
import { parseAmount } from '@/lib/money';
import { useCurrentUser } from '@/contexts/ProfileContext';
import { useToast } from '@/contexts/ToastContext';
import { useAddContribution, useGoals } from '@/hooks/queries';
import { AmountInput, Input, Select } from './ui/Field';
import { Button } from './ui/Button';
import { EmptyState } from './ui/Skeleton';
import { Target } from 'lucide-react';

/** Adds money to a savings goal from the quick-add sheet. */
export function GoalContributionForm({
  onDone, onCancel, initialGoalId,
}: {
  onDone: () => void;
  onCancel: () => void;
  initialGoalId?: string;
}) {
  const user = useCurrentUser();
  const toast = useToast();
  const { data: goals = [], isLoading } = useGoals();
  const [goalId, setGoalId] = useState(initialGoalId ?? '');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const mutation = useAddContribution();

  const active = goals.filter((goal) => goal.status === 'active');

  useEffect(() => {
    if (!goalId && active.length > 0) setGoalId(active[0]?.id ?? '');
  }, [active, goalId]);

  if (!isLoading && active.length === 0) {
    return (
      <EmptyState
        icon={<Target className="h-6 w-6" aria-hidden />}
        title="No active savings goals"
        description="Create a goal first, then you can put money towards it from here."
        action={<Button variant="outline" onClick={onCancel}>Back</Button>}
      />
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const minor = parseAmount(amount, user.currency);
    if (minor === null || minor === 0) {
      setErrors({ amount: 'Enter an amount.' });
      return;
    }
    try {
      await mutation.mutateAsync({ goalId, amount, note: note.trim() || undefined });
      toast.success('Added to your goal', 'Progress updated.');
      onDone();
    } catch (error) {
      toast.error(error instanceof AppError ? error.message : 'That did not save.');
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <Select
        label="Goal"
        required
        options={active.map((goal) => ({ value: goal.id, label: goal.name }))}
        value={goalId}
        onChange={(event) => setGoalId(event.target.value)}
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
        hint="Use a minus amount to take money back out of the goal."
      />
      <Input
        label="Note"
        placeholder="Optional"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={200}
      />
      <p className="rounded-xl bg-surface-2 p-3 text-xs leading-relaxed text-ink-2">
        Goal progress is tracked separately from your account balances, so adding
        to a goal here does not move money between accounts. Use a transfer if you
        also want the money to sit in a different account.
      </p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={mutation.isPending}>
          Back
        </Button>
        <Button type="submit" loading={mutation.isPending}>Add to goal</Button>
      </div>
    </form>
  );
}
