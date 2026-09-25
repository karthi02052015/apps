import { asc, eq, inArray } from 'drizzle-orm';
import { rankToPriority, type SubtaskDTO, type TaskDTO } from '@taskflow/shared';
import type { DbOrTx } from '../../db/client';
import { subtasks, tags, taskTags, type Subtask, type Task } from '../../db/schema';

export const toSubtaskDTO = (s: Subtask): SubtaskDTO => ({ id: s.id, title: s.title, done: s.done, position: s.position });

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toTaskDTO(t: Task, tagNames: string[], subs: Subtask[]): TaskDTO {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: rankToPriority(t.priority),
    projectId: t.projectId,
    dueAt: iso(t.dueAt),
    allDay: t.allDay,
    remindAt: iso(t.remindAt),
    recurrence: t.recurrence,
    position: t.position,
    completedAt: iso(t.completedAt),
    deletedAt: iso(t.deletedAt),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    version: t.version,
    tags: tagNames,
    subtasks: subs.map(toSubtaskDTO),
  };
}

/**
 * Hydrate task rows with tags and subtasks in exactly two extra queries,
 * regardless of page size (no N+1).
 */
export async function hydrateTasks(db: DbOrTx, rows: Task[]): Promise<TaskDTO[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [tagRows, subRows] = await Promise.all([
    db
      .select({ taskId: taskTags.taskId, name: tags.name })
      .from(taskTags)
      .innerJoin(tags, eq(tags.id, taskTags.tagId))
      .where(inArray(taskTags.taskId, ids))
      .orderBy(asc(tags.name)),
    db.select().from(subtasks).where(inArray(subtasks.taskId, ids)).orderBy(asc(subtasks.position), asc(subtasks.createdAt)),
  ]);

  const tagsByTask = new Map<string, string[]>();
  for (const r of tagRows) (tagsByTask.get(r.taskId) ?? tagsByTask.set(r.taskId, []).get(r.taskId)!).push(r.name);
  const subsByTask = new Map<string, Subtask[]>();
  for (const s of subRows) (subsByTask.get(s.taskId) ?? subsByTask.set(s.taskId, []).get(s.taskId)!).push(s);

  return rows.map((r) => toTaskDTO(r, tagsByTask.get(r.id) ?? [], subsByTask.get(r.id) ?? []));
}
