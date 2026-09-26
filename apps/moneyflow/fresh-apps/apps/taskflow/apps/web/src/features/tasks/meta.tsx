import { AlarmClock, CalendarDays, Flag, Repeat } from 'lucide-react';
import { motion } from 'motion/react';
import { RECURRENCE_LABELS, TASK_PRIORITY_LABELS, type TaskDTO, type TaskPriority } from '@taskflow/shared';
import { cn } from '../../lib/cn';
import { dueLabel, type DueTone } from '../../lib/dates';

export const PRIORITY_COLOR: Record<TaskPriority, string> = {
  urgent: '#ef4444',
  high: '#f97316',
  medium: '#3b82f6',
  low: '#94a3b8',
  none: 'var(--border-strong)',
};

export function PriorityFlag({ priority, className }: { priority: TaskPriority; className?: string }) {
  if (priority === 'none') return null;
  return (
    <Flag
      className={cn('size-3.5', className)}
      style={{ color: PRIORITY_COLOR[priority], fill: priority === 'urgent' || priority === 'high' ? PRIORITY_COLOR[priority] : 'none' }}
      aria-label={`${TASK_PRIORITY_LABELS[priority]} priority`}
    />
  );
}

const TONE: Record<DueTone, string> = {
  overdue: 'text-danger',
  today: 'text-success',
  soon: 'text-warning',
  later: 'text-muted',
  done: 'text-subtle',
};

export function DueBadge({ task, className }: { task: Pick<TaskDTO, 'dueAt' | 'allDay' | 'status' | 'recurrence'>; className?: string }) {
  const due = dueLabel(task);
  if (!due) return null;
  return (
    <span className={cn('inline-flex items-center gap-1 text-[12px] font-medium', TONE[due.tone], className)}>
      <CalendarDays className="size-3.5" aria-hidden />
      {due.label}
      {task.recurrence ? <Repeat className="size-3" aria-label={RECURRENCE_LABELS[task.recurrence]} /> : null}
    </span>
  );
}

export function ReminderBadge({ remindAt }: { remindAt: string | null }) {
  if (!remindAt || new Date(remindAt) < new Date()) return null;
  return <AlarmClock className="size-3.5 text-muted" aria-label="Reminder set" />;
}

/** Circular checkbox tinted by priority, with a satisfying completion animation. */
export function TaskCheckbox({
  checked,
  priority,
  onChange,
  label,
  size = 'md',
}: {
  checked: boolean;
  priority: TaskPriority;
  onChange: () => void;
  label: string;
  size?: 'sm' | 'md';
}) {
  const color = priority === 'none' ? 'var(--text-subtle)' : PRIORITY_COLOR[priority];
  const dim = size === 'sm' ? 'size-4' : 'size-[18px]';
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={checked ? `Mark "${label}" as not done` : `Complete "${label}"`}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={cn('group/cb relative grid shrink-0 place-items-center rounded-full border-[1.5px] transition-colors', dim)}
      style={{ borderColor: color, backgroundColor: checked ? color : `color-mix(in srgb, ${color} 8%, transparent)` }}
    >
      <motion.svg
        viewBox="0 0 24 24"
        className={cn('size-[70%]', checked ? 'text-white' : 'opacity-0 group-hover/cb:opacity-60')}
        style={{ color: checked ? '#fff' : color }}
        initial={false}
        animate={{ scale: checked ? 1 : 0.8 }}
        transition={{ type: 'spring', stiffness: 500, damping: 25 }}
      >
        <motion.path
          d="M5 12.5l4.5 4.5L19 7.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          animate={{ pathLength: 1 }}
        />
      </motion.svg>
    </button>
  );
}
