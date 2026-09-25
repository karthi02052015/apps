import { CalendarDays, CornerDownLeft, Flag, Folder, Hash, Plus, Repeat } from 'lucide-react';
import { forwardRef, useMemo, useState, type FormEvent } from 'react';
import { RECURRENCE_LABELS, TASK_PRIORITY_LABELS, parseQuickAdd, type CreateTaskInput, type ProjectDTO } from '@taskflow/shared';
import { timeZone } from '../../lib/api';
import { cn } from '../../lib/cn';
import { dueLabel } from '../../lib/dates';

const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '');

interface Props {
  projects: ProjectDTO[];
  defaults: Partial<CreateTaskInput>;
  onCreate: (input: CreateTaskInput) => void;
  placeholder?: string;
}

/**
 * The fastest path from thought to task. Natural language is parsed live and
 * shown as chips, so users learn the syntax by seeing it recognised.
 */
export const QuickAdd = forwardRef<HTMLInputElement, Props>(function QuickAdd({ projects, defaults, onCreate, placeholder }, ref) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);

  const parsed = useMemo(() => (value.trim() ? parseQuickAdd(value, new Date(), timeZone) : null), [value]);
  const project = useMemo(
    () => (parsed?.project ? projects.find((p) => norm(p.name) === norm(parsed.project!)) : undefined),
    [parsed, projects],
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!parsed?.title.trim()) return;
    onCreate({
      ...defaults,
      title: parsed.title,
      ...(parsed.dueAt ? { dueAt: parsed.dueAt.toISOString(), allDay: parsed.allDay } : {}),
      ...(parsed.priority ? { priority: parsed.priority } : {}),
      // Merge with context tags (e.g. on /tags/work) so the new task stays in view.
      ...(parsed.tags.length ? { tags: Array.from(new Set([...(defaults.tags ?? []), ...parsed.tags])) } : {}),
      ...(parsed.recurrence ? { recurrence: parsed.recurrence } : {}),
      ...(project ? { projectId: project.id } : {}),
    });
    setValue('');
  };

  const due = parsed?.dueAt ? dueLabel({ dueAt: parsed.dueAt.toISOString(), allDay: parsed.allDay, status: 'todo' }) : null;
  const chips = parsed
    ? [
        due && { icon: CalendarDays, label: due.label, tone: 'text-success' },
        parsed.recurrence && { icon: Repeat, label: RECURRENCE_LABELS[parsed.recurrence], tone: 'text-accent' },
        parsed.priority && { icon: Flag, label: TASK_PRIORITY_LABELS[parsed.priority], tone: 'text-warning' },
        ...parsed.tags.map((t) => ({ icon: Hash, label: t, tone: 'text-muted' })),
        parsed.project && {
          icon: Folder,
          label: project ? project.name : `No project “${parsed.project}”`,
          tone: project ? 'text-muted' : 'text-danger',
        },
      ].filter(Boolean) as Array<{ icon: typeof Hash; label: string; tone: string }>
    : [];

  return (
    <form onSubmit={submit} className="relative">
      <div
        className={cn(
          'flex items-center gap-3 rounded-xl border bg-surface px-3.5 shadow-soft transition-[border-color,box-shadow]',
          focused ? 'border-accent ring-4 ring-accent/10' : 'border-border',
        )}
      >
        <Plus className={cn('size-[18px] shrink-0 transition-colors', focused ? 'text-accent' : 'text-subtle')} aria-hidden />
        <input
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => e.key === 'Escape' && (e.currentTarget.blur(), setValue(''))}
          placeholder={placeholder ?? 'Add a task…  try "Pay rent friday 9am #home !high"'}
          aria-label="Add a task"
          maxLength={500}
          className="h-12 min-w-0 flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-subtle"
          data-testid="quick-add"
        />
        {value.trim() ? (
          <button type="submit" className="hidden items-center gap-1 rounded-md bg-accent px-2 py-1 text-[12px] font-medium text-accent-contrast sm:inline-flex">
            Add <CornerDownLeft className="size-3" />
          </button>
        ) : null}
      </div>
      {chips.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5 px-1" aria-live="polite">
          {chips.map(({ icon: Icon, label, tone }) => (
            <span key={label} className={cn('inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-0.5 text-[12px] font-medium', tone)}>
              <Icon className="size-3" aria-hidden />
              {label}
            </span>
          ))}
        </div>
      ) : null}
    </form>
  );
});
