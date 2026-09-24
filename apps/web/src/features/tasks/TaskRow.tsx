import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, ListChecks, MessageSquareText } from 'lucide-react';
import { motion } from 'motion/react';
import { memo } from 'react';
import type { ProjectDTO, TaskDTO } from '@taskflow/shared';
import { cn } from '../../lib/cn';
import { DueBadge, PriorityFlag, ReminderBadge, TaskCheckbox } from './meta';

export interface TaskRowProps {
  task: TaskDTO;
  project?: ProjectDTO;
  showProject?: boolean;
  onOpen: (id: string) => void;
  onToggle: (task: TaskDTO) => void;
  sortable?: boolean;
  selecting?: boolean;
  selected?: boolean;
  onSelect?: (id: string) => void;
}

function TaskRowInner({ task, project, showProject = true, onOpen, onToggle, sortable, selecting, selected, onSelect }: TaskRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !sortable || selecting,
  });
  const done = task.status === 'done';
  const pending = task.id.startsWith('temp-');
  const subDone = task.subtasks.filter((s) => s.done).length;

  return (
    <motion.li
      ref={setNodeRef}
      layout="position"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: pending ? 0.6 : 1, y: 0 }}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group relative flex items-start gap-3 border-b border-border/70 px-2 py-2.5 last:border-b-0 sm:px-3',
        'cursor-pointer rounded-none transition-colors hover:bg-surface-2/60 sm:rounded-lg sm:border-b-0',
        isDragging && 'z-10 bg-surface shadow-pop',
        selected && 'bg-accent-soft/70 hover:bg-accent-soft',
      )}
      onClick={() => (selecting ? onSelect?.(task.id) : onOpen(task.id))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(task.id);
        if (e.key === ' ' && e.target === e.currentTarget) {
          e.preventDefault();
          onToggle(task);
        }
      }}
      tabIndex={0}
      aria-label={task.title}
      data-testid="task-row"
    >
      {sortable && !selecting ? (
        <button
          type="button"
          className="absolute -left-4 top-3 hidden cursor-grab text-subtle opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing md:block"
          aria-label="Drag to reorder"
          onClick={(e) => e.stopPropagation()}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
      ) : null}

      <div className="pt-[1px]">
        {selecting ? (
          <input
            type="checkbox"
            checked={!!selected}
            onChange={() => onSelect?.(task.id)}
            onClick={(e) => e.stopPropagation()}
            className="size-[18px] accent-[var(--accent)]"
            aria-label={`Select "${task.title}"`}
          />
        ) : (
          <TaskCheckbox checked={done} priority={task.priority} onChange={() => onToggle(task)} label={task.title} />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className={cn('min-w-0 flex-1 break-words text-[14px] leading-[1.35]', done && 'text-subtle line-through decoration-subtle/60')}>
            {task.title}
          </p>
          <PriorityFlag priority={task.priority} className="mt-0.5 shrink-0" />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 empty:hidden">
          <DueBadge task={task} />
          <ReminderBadge remindAt={task.remindAt} />
          {task.subtasks.length ? (
            <span className="inline-flex items-center gap-1 text-[12px] text-muted">
              <ListChecks className="size-3.5" aria-hidden />
              {subDone}/{task.subtasks.length}
            </span>
          ) : null}
          {task.description ? <MessageSquareText className="size-3.5 text-subtle" aria-label="Has notes" /> : null}
          {task.tags.map((t) => (
            <span key={t} className="text-[12px] text-muted">
              #{t}
            </span>
          ))}
          {showProject && project ? (
            <span className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-muted">
              <span className="size-2 rounded-full" style={{ backgroundColor: project.color }} aria-hidden />
              {project.name}
            </span>
          ) : null}
        </div>
      </div>
    </motion.li>
  );
}

export const TaskRow = memo(TaskRowInner);
