import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useMemo } from 'react';
import type { ProjectDTO, TaskDTO } from '@taskflow/shared';
import { TaskRow } from './TaskRow';

export interface TaskGroup {
  key: string;
  label: string;
  tone?: 'danger' | 'default';
  tasks: TaskDTO[];
}

interface Props {
  groups: TaskGroup[];
  projects: Map<string, ProjectDTO>;
  showProject: boolean;
  sortable: boolean;
  onOpen: (id: string) => void;
  onToggle: (t: TaskDTO) => void;
  onReorder: (id: string, position: number) => void;
  selecting: boolean;
  selected: Set<string>;
  onSelect: (id: string) => void;
}

/** Midpoint between neighbours — O(1) reorder with a single PATCH. */
export function positionBetween(before?: number, after?: number): number {
  if (before === undefined && after === undefined) return Date.now();
  if (before === undefined) return after! - 1024;
  if (after === undefined) return before + 1024;
  return (before + after) / 2;
}

export function TaskList({ groups, projects, showProject, sortable, onOpen, onToggle, onReorder, selecting, selected, onSelect }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const flat = useMemo(() => groups.flatMap((g) => g.tasks), [groups]);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = flat.findIndex((t) => t.id === active.id);
    const to = flat.findIndex((t) => t.id === over.id);
    if (from < 0 || to < 0) return;
    const moved = arrayMove(flat, from, to);
    onReorder(String(active.id), positionBetween(moved[to - 1]?.position, moved[to + 1]?.position));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={flat.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.key} aria-label={g.label}>
              {groups.length > 1 || g.label ? (
                <h2
                  className={`mb-1 flex items-center gap-2 px-2 text-[12.5px] font-semibold sm:px-3 ${g.tone === 'danger' ? 'text-danger' : 'text-muted'}`}
                >
                  {g.label}
                  <span className="font-normal text-subtle">{g.tasks.length}</span>
                </h2>
              ) : null}
              <ul className="-mx-2 sm:mx-0">
                  {g.tasks.map((t) => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      project={t.projectId ? projects.get(t.projectId) : undefined}
                      showProject={showProject}
                      onOpen={onOpen}
                      onToggle={onToggle}
                      sortable={sortable}
                      selecting={selecting}
                      selected={selected.has(t.id)}
                      onSelect={onSelect}
                    />
                  ))}
              </ul>
            </section>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
