import { useState } from 'react';
import { ArrowLeftRight, CreditCard, Minus, Plus, Target } from 'lucide-react';
import { Modal } from './ui/Modal';
import { TransactionForm } from './TransactionForm';
import { GoalContributionForm } from './GoalContributionForm';
import { DebtPaymentForm } from './DebtPaymentForm';
import type { TransactionType } from '@/types/api';
import { cn } from '@/lib/cn';

type Mode = 'menu' | TransactionType | 'savings' | 'debt';

const ACTIONS: {
  mode: Mode;
  label: string;
  hint: string;
  icon: typeof Plus;
  className: string;
}[] = [
  {
    mode: 'income',
    label: 'Money received',
    hint: 'Salary, freelance, refund, gift',
    icon: Plus,
    className: 'bg-positive-soft text-positive',
  },
  {
    mode: 'expense',
    label: 'Expense',
    hint: 'Anything you spent',
    icon: Minus,
    className: 'bg-negative-soft text-negative',
  },
  {
    mode: 'transfer',
    label: 'Transfer',
    hint: 'Move money between your accounts',
    icon: ArrowLeftRight,
    className: 'bg-brand-soft text-brand',
  },
  {
    mode: 'savings',
    label: 'Add to a goal',
    hint: 'Put money towards something you are saving for',
    icon: Target,
    className: 'bg-caution-soft text-caution',
  },
  {
    mode: 'debt',
    label: 'Debt repayment',
    hint: 'Record money paid or received back',
    icon: CreditCard,
    className: 'bg-surface-3 text-ink-2',
  },
];

const TITLES: Record<string, string> = {
  income: 'Add money',
  expense: 'Add an expense',
  transfer: 'Transfer between accounts',
  adjustment: 'Adjust a balance',
  savings: 'Add to a savings goal',
  debt: 'Record a repayment',
};

/**
 * The floating "+" action (section 45).
 *
 * Deliberately a two-step flow — pick what kind of thing happened, then fill in
 * one short form — rather than one form with a type selector. Choosing from five
 * large targets is faster on a phone than finding the right segment of a
 * control, and it means each form only ever shows the fields that apply.
 */
export function QuickAdd({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('menu');

  const close = () => {
    onClose();
    // Reset after the exit animation so the menu does not flash on the way out.
    setTimeout(() => setMode('menu'), 200);
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={mode === 'menu' ? 'What would you like to record?' : TITLES[mode] ?? 'Add'}
      size={mode === 'menu' ? 'md' : 'lg'}
    >
      {mode === 'menu' ? (
        <div className="space-y-2">
          {ACTIONS.map((action) => (
            <button
              key={action.mode}
              type="button"
              onClick={() => setMode(action.mode)}
              className="flex w-full items-center gap-3.5 rounded-2xl border border-line bg-surface p-3.5 text-left transition-all hover:border-brand/40 hover:bg-surface-2 active:scale-[0.99]"
            >
              <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', action.className)} aria-hidden>
                <action.icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink">{action.label}</span>
                <span className="block truncate text-xs text-ink-2">{action.hint}</span>
              </span>
            </button>
          ))}
        </div>
      ) : mode === 'savings' ? (
        <GoalContributionForm onDone={close} onCancel={() => setMode('menu')} />
      ) : mode === 'debt' ? (
        <DebtPaymentForm onDone={close} onCancel={() => setMode('menu')} />
      ) : (
        <TransactionForm type={mode} onDone={close} onCancel={() => setMode('menu')} />
      )}
    </Modal>
  );
}
