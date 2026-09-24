import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useDraggable } from '@dnd-kit/core';
import { ListChecks } from 'lucide-react';
import { useState } from 'react';
import { TASK_STATUSES, TASK_STATUS_LABELS, type ProjectDTO, type TaskDTO, type TaskStatus } from '@taskflow/shared';
import { cn } from '../../lib/cn';
import { DueBadge, PriorityFlag, TaskCheckbox } from './meta';

interface Props {
  tasks: TaskDTO[];
  projects: Map<string, ProjectDTO>;
  onOpen: (id: string) => void;
  onToggle: (t: TaskDTO) => void;
  onMove: (id: string, status: TaskStatus) => void;
}

const COLUMN_ACCENT: Record<TaskStatus, string> = { todo: 'bg-subtle', in_progress: 'bg-warning', done: 'bg-success' };

function Card({ task, project, onOpen, onToggle, overlay }: { task: TaskDTO; project?: ProjectDTO; onOpen?: (id: string) => void; onToggle?: (t: TaskDTO) => void; overlay?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, disabled: overlay });
  const subDone = task.subtasks.filter((s) => s.done).length;
  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      {...(overlay ? {} : attributes)}
      {...(overlay ? {} : listeners)}
      onClick={() => onOpen?.(task.id)}
      className={cn(
        'cursor-grab rounded-xl border border-border bg-surface p-3 shadow-soft transition-shadow hover:shadow-pop active:cursor-grabbing',
        isDragging && 'opacity-40',
        overlay && 'rotate-[1.5deg] shadow-pop',
      )}
      data-testid="board-card"
    >
      <div className="flex items-start gap-2.5">
        <div className="pt-[1px]">
          <TaskCheckbox checked={task.status === 'done'} priority={task.priority} onChange={() => onToggle?.(task)} label={task.title} size="sm" />
        </div>
        <p className={cn('min-w-0 flex-1 break-words text-[13.5px] leading-snug', task.status === 'done' && 'text-subtle line-through')}>{task.title}</p>
        <PriorityFlag priority={task.priority} />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-[26px] empty:hidden">
        <DueBadge task={task} />
        {task.subtasks.length ? (
          <span className="inline-flex items-center gap-1 text-[12px] text-muted">
            <ListChecks className="size-3.5" aria-hidden />
            {subDone}/{task.subtasks.length}
          </span>
        ) : null}
        {project ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
            <span className="size-2 rounded-full" style={{ backgroundColor: project.color }} aria-hidden />
            {project.name}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Column({ status, children, count }: { status: TaskStatus; children: React.ReactNode; count: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      aria-label={TASK_STATUS_LABELS[status]}
      className={cn(
        'flex w-[85vw] shrink-0 snap-start flex-col rounded-2xl bg-surface-2/60 p-2 transition-colors sm:w-auto sm:min-w-0 sm:flex-1',
        isOver && 'bg-accent-soft ring-2 ring-accent/30',
      )}
    >
      <header className="flex items-center gap-2 px-2 pb-2 pt-1">
        <span className={cn('size-2 rounded-full', COLUMN_ACCENT[status])} aria-hidden />
        <h2 className="text-[13px] font-semibold">{TASK_STATUS_LABELS[status]}</h2>
        <span className="text-[12px] text-subtle">{count}</span>
      </header>
      <div className="flex min-h-24 flex-col gap-2">{children}</div>
    </section>
  );
}

export function TaskBoard({ tasks, projects, onOpen, onToggle, onMove }: Props) {
  const [active, setActive] = useState<TaskDTO | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const onStart = ({ active: a }: DragStartEvent) => setActive(tasks.find((t) => t.id === a.id) ?? null);
  const onEnd = ({ active: a, over }: DragEndEvent) => {
    setActive(null);
    const target = over?.id as TaskStatus | undefined;
    const task = tasks.find((t) => t.id === a.id);
    if (task && target && target !== task.status) onMove(task.id, target);
  };

  return (
    <DndContext sensors={sensors} onDragStart={onStart} onDragEnd={onEnd} onDragCancel={() => setActive(null)}>
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
        {TASK_STATUSES.map((status) => {
          const col = tasks.filter((t) => t.status === status);
          return (
            <Column key={status} status={status} count={col.length}>
              {col.map((t) => (
                <Card key={t.id} task={t} project={t.projectId ? projects.get(t.projectId) : undefined} onOpen={onOpen} onToggle={onToggle} />
              ))}
              {col.length === 0 ? <p className="px-2 py-6 text-center text-[12.5px] text-subtle">Drop tasks here</p> : null}
            </Column>
          );
        })}
      </div>
      <DragOverlay dropAnimation={null}>{active ? <Card task={active} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}
