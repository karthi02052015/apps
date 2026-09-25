import { formatDistanceToNow } from 'date-fns';
import { AlarmClock, CalendarDays, Flag, Folder, Hash, Repeat, RotateCcw, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  RECURRENCE_LABELS,
  RECURRENCE_RULES,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type ProjectDTO,
  type RecurrenceRule,
  type TaskDTO,
  type TaskPriority,
  type UpdateTaskInput,
} from '@taskflow/shared';
import { Button } from '../../components/ui/Button';
import { Sheet, SheetClose } from '../../components/ui/Dialog';
import { Input, Select, Textarea } from '../../components/ui/Input';
import { Skeleton } from '../../components/ui/Spinner';
import { cn } from '../../lib/cn';
import { fromInputs, startOfLocalDay, toDateInput, toTimeInput } from '../../lib/dates';
import { useDeleteTask, useRestoreTask, useSubtaskMutations, useTask, useToggleComplete, useUpdateTask } from './hooks';
import { TaskCheckbox } from './meta';

interface Props {
  taskId: string | null;
  projects: ProjectDTO[];
  onClose: () => void;
}

export function TaskDetailSheet({ taskId, projects, onClose }: Props) {
  const { data: task, isError } = useTask(taskId);
  return (
    <Sheet open={!!taskId} onOpenChange={(o) => !o && onClose()} title={task?.title ?? 'Task details'}>
      {isError ? (
        <div className="p-6">
          <p className="text-[14px] text-muted">This task could not be loaded. It may have been deleted.</p>
          <Button variant="outline" className="mt-4" onClick={onClose}>
            Close
          </Button>
        </div>
      ) : task ? (
        <TaskDetail key={task.id} task={task} projects={projects} onClose={onClose} />
      ) : (
        <div className="space-y-4 p-6">
          <Skeleton className="h-7 w-3/4" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-9 w-1/2" />
        </div>
      )}
    </Sheet>
  );
}

function Row({ icon: Icon, label, children }: { icon: typeof Flag; label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[104px_1fr] items-start gap-3 py-1.5">
      <span className="inline-flex h-9 items-center gap-2 text-[13px] text-muted">
        <Icon className="size-4" aria-hidden />
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function TaskDetail({ task, projects, onClose }: { task: TaskDTO; projects: ProjectDTO[]; onClose: () => void }) {
  const update = useUpdateTask();
  const toggle = useToggleComplete();
  const del = useDeleteTask();
  const restore = useRestoreTask();
  const subs = useSubtaskMutations(task.id);

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [newSub, setNewSub] = useState('');
  const [tagDraft, setTagDraft] = useState('');
  const titleRef = useRef<HTMLTextAreaElement>(null);

  // Keep local drafts in sync when the task changes elsewhere (realtime / other tab),
  // unless the user is currently editing that field.
  useEffect(() => {
    if (document.activeElement !== titleRef.current) setTitle(task.title);
  }, [task.title]);
  useEffect(() => {
    setDescription((d) => (document.activeElement?.id === 'task-notes' ? d : task.description ?? ''));
  }, [task.description]);

  const save = (input: UpdateTaskInput) => update.mutate({ id: task.id, input });
  const trashed = !!task.deletedAt;

  const commitTitle = () => {
    const t = title.trim();
    if (!t) return setTitle(task.title);
    if (t !== task.title) save({ title: t });
  };

  const setDue = (date: string, time: string) => {
    const { dueAt, allDay } = fromInputs(date, time);
    save({ dueAt, allDay, ...(dueAt ? {} : { recurrence: null }) });
  };
  const quickDue = (offset: number | null) =>
    save(offset === null ? { dueAt: null, allDay: false, recurrence: null } : { dueAt: startOfLocalDay(offset).toISOString(), allDay: true });

  const addTag = (raw: string) => {
    const tag = raw.trim().replace(/^#/, '').toLowerCase();
    if (!tag || !/^[\p{L}\p{N}_-]{1,40}$/u.test(tag) || task.tags.includes(tag)) return setTagDraft('');
    save({ tags: [...task.tags, tag] });
    setTagDraft('');
  };
  const onTagKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(tagDraft);
    } else if (e.key === 'Backspace' && !tagDraft && task.tags.length) {
      save({ tags: task.tags.slice(0, -1) });
    }
  };

  const reminderValue = task.remindAt ? toDateInput(task.remindAt) + 'T' + toTimeInput(task.remindAt, false) : '';

  return (
    <>
      <header className="flex items-start gap-3 border-b border-border px-5 pb-4 pt-5">
        <div className="pt-1.5">
          <TaskCheckbox checked={task.status === 'done'} priority={task.priority} onChange={() => toggle(task)} label={task.title} />
        </div>
        <textarea
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          rows={1}
          maxLength={500}
          disabled={trashed}
          aria-label="Task title"
          className={cn(
            'field-sizing-content min-h-9 flex-1 resize-none bg-transparent text-[18px] font-semibold leading-snug tracking-tight outline-none',
            task.status === 'done' && 'text-muted line-through',
          )}
        />
        <SheetClose className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Close">
          <X className="size-4" />
        </SheetClose>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {trashed ? (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2.5 text-[13px]">
            <span>This task is in the trash.</span>
            <Button size="sm" variant="outline" onClick={() => restore.mutate(task.id)}>
              <RotateCcw className="size-3.5" /> Restore
            </Button>
          </div>
        ) : null}

        <fieldset disabled={trashed} className="space-y-0.5">
          <div className="mb-3 inline-flex rounded-lg bg-surface-2 p-0.5" role="radiogroup" aria-label="Status">
            {TASK_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={task.status === s}
                onClick={() => task.status !== s && save({ status: s })}
                className={cn(
                  'rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors',
                  task.status === s ? 'bg-surface text-fg shadow-soft' : 'text-muted hover:text-fg',
                )}
              >
                {TASK_STATUS_LABELS[s]}
              </button>
            ))}
          </div>

          <Row icon={CalendarDays} label="Due">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="date"
                aria-label="Due date"
                className="h-9 w-[150px]"
                value={toDateInput(task.dueAt)}
                onChange={(e) => setDue(e.target.value, toTimeInput(task.dueAt, task.allDay))}
              />
              <Input
                type="time"
                aria-label="Due time"
                className="h-9 w-[128px]"
                value={toTimeInput(task.dueAt, task.allDay)}
                disabled={!task.dueAt}
                onChange={(e) => setDue(toDateInput(task.dueAt), e.target.value)}
              />
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {[
                ['Today', 0],
                ['Tomorrow', 1],
                ['Next week', 7],
                ['Clear', null],
              ].map(([label, off]) => (
                <button
                  key={label as string}
                  type="button"
                  onClick={() => quickDue(off as number | null)}
                  className="rounded-md px-2 py-0.5 text-[12px] text-muted hover:bg-surface-2 hover:text-fg"
                >
                  {label}
                </button>
              ))}
            </div>
          </Row>

          <Row icon={Repeat} label="Repeat">
            <Select
              aria-label="Repeat"
              value={task.recurrence ?? ''}
              disabled={!task.dueAt}
              title={!task.dueAt ? 'Set a due date to repeat' : undefined}
              onChange={(e) => save({ recurrence: (e.target.value || null) as RecurrenceRule | null })}
              className="w-full max-w-[220px]"
            >
              <option value="">Never</option>
              {RECURRENCE_RULES.map((r) => (
                <option key={r} value={r}>
                  {RECURRENCE_LABELS[r]}
                </option>
              ))}
            </Select>
          </Row>

          <Row icon={AlarmClock} label="Reminder">
            <div className="flex items-center gap-2">
              <Input
                type="datetime-local"
                aria-label="Reminder"
                className="h-9 w-full max-w-[220px]"
                value={reminderValue}
                onChange={(e) => save({ remindAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
              />
              {task.remindAt ? (
                <Button size="icon-sm" variant="ghost" aria-label="Clear reminder" onClick={() => save({ remindAt: null })}>
                  <X className="size-3.5" />
                </Button>
              ) : null}
            </div>
          </Row>

          <Row icon={Flag} label="Priority">
            <Select
              aria-label="Priority"
              value={task.priority}
              onChange={(e) => save({ priority: e.target.value as TaskPriority })}
              className="w-full max-w-[220px]"
            >
              {[...TASK_PRIORITIES].reverse().map((p) => (
                <option key={p} value={p}>
                  {TASK_PRIORITY_LABELS[p]}
                </option>
              ))}
            </Select>
          </Row>

          <Row icon={Folder} label="Project">
            <Select
              aria-label="Project"
              value={task.projectId ?? ''}
              onChange={(e) => save({ projectId: e.target.value || null })}
              className="w-full max-w-[220px]"
            >
              <option value="">Inbox</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Row>

          <Row icon={Hash} label="Tags">
            <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1 focus-within:border-accent">
              {task.tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-md bg-surface-2 py-0.5 pl-2 pr-1 text-[12px] font-medium">
                  #{t}
                  <button
                    type="button"
                    aria-label={`Remove tag ${t}`}
                    className="rounded p-0.5 text-muted hover:text-fg"
                    onClick={() => save({ tags: task.tags.filter((x) => x !== t) })}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              <input
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={onTagKey}
                onBlur={() => tagDraft && addTag(tagDraft)}
                placeholder={task.tags.length ? '' : 'Add tag…'}
                aria-label="Add tag"
                className="h-6 min-w-16 flex-1 bg-transparent text-[13px] outline-none placeholder:text-subtle"
              />
            </div>
          </Row>

          <div className="pt-4">
            <label htmlFor="task-notes" className="mb-1.5 block text-[13px] font-medium">
              Notes
            </label>
            <Textarea
              id="task-notes"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => description !== (task.description ?? '') && save({ description: description || null })}
              placeholder="Add details, links, context…"
              maxLength={20000}
            />
          </div>

          <div className="pt-5">
            <h3 className="mb-2 flex items-center justify-between text-[13px] font-medium">
              Subtasks
              {task.subtasks.length ? (
                <span className="text-[12px] font-normal text-muted">
                  {task.subtasks.filter((s) => s.done).length} of {task.subtasks.length}
                </span>
              ) : null}
            </h3>
            {task.subtasks.length ? (
              <div className="mb-2 h-1 overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full rounded-full bg-success transition-[width] duration-300"
                  style={{ width: `${(task.subtasks.filter((s) => s.done).length / task.subtasks.length) * 100}%` }}
                />
              </div>
            ) : null}
            <ul className="space-y-0.5">
              {task.subtasks.map((s) => (
                <li key={s.id} className="group flex items-center gap-2.5 rounded-lg px-1 py-1 hover:bg-surface-2/60">
                  <TaskCheckbox size="sm" checked={s.done} priority="none" label={s.title} onChange={() => subs.update.mutate({ id: s.id, input: { done: !s.done } })} />
                  <span className={cn('flex-1 text-[13.5px]', s.done && 'text-subtle line-through')}>{s.title}</span>
                  <button
                    type="button"
                    aria-label={`Delete subtask ${s.title}`}
                    onClick={() => subs.remove.mutate(s.id)}
                    className="rounded p-1 text-subtle opacity-0 hover:text-danger focus:opacity-100 group-hover:opacity-100"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="mt-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (newSub.trim()) subs.add.mutate(newSub.trim());
                setNewSub('');
              }}
            >
              <input
                value={newSub}
                onChange={(e) => setNewSub(e.target.value)}
                placeholder="+ Add subtask"
                aria-label="Add subtask"
                maxLength={500}
                className="h-8 w-full rounded-lg bg-transparent px-1 text-[13.5px] outline-none placeholder:text-subtle focus:bg-surface-2/60"
              />
            </form>
          </div>
        </fieldset>
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-[12px] text-subtle">
        <span>
          Created {formatDistanceToNow(new Date(task.createdAt), { addSuffix: true })}
          {task.completedAt ? ` · Done ${formatDistanceToNow(new Date(task.completedAt), { addSuffix: true })}` : ''}
        </span>
        {trashed ? (
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              del.mutate({ id: task.id, permanent: true });
              onClose();
            }}
          >
            Delete forever
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="text-danger hover:text-danger"
            onClick={() => {
              del.mutate({ id: task.id, title: task.title });
              onClose();
            }}
          >
            <Trash2 className="size-3.5" /> Delete
          </Button>
        )}
      </footer>
    </>
  );
}
