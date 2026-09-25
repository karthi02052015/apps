import { and, asc, desc, eq, inArray, isNotNull, isNull, max, ne, sql } from 'drizzle-orm';
import {
  LIMITS,
  nextOccurrence,
  priorityToRank,
  startOfZonedDay,
  startOfZonedWeek,
  zonedDateKey,
  type BulkTaskInput,
  type ListTasksQuery,
  type Page,
  type SubtaskDTO,
  type TaskDTO,
  type TaskMutationResult,
  type TaskStatsDTO,
  type createTaskSchema,
  type updateTaskSchema,
} from '@taskflow/shared';
import type { z } from 'zod';
import type { AppContext } from '../../context';
import { rowsOf, type DbOrTx } from '../../db/client';
import { projects, subtasks, tags, taskTags, tasks, type NewTask, type Task } from '../../db/schema';
import { decodeCursor, encodeCursor } from '../../lib/cursor';
import { AppError } from '../../lib/errors';
import type { RequestMeta } from '../../lib/http';
import { hydrateTasks, toSubtaskDTO } from './tasks.mapper';
import {
  SORT_EXPR,
  dayContext,
  filterConditions,
  isKeysetCursor,
  keysetCondition,
  overdueCondition,
  resolveSort,
} from './tasks.query';

type CreateTask = z.output<typeof createTaskSchema>;
type UpdateTask = z.output<typeof updateTaskSchema>;

const date = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : new Date(v));

export class TasksService {
  constructor(private readonly ctx: AppContext) {}

  private get db() {
    return this.ctx.db;
  }

  private changed(userId: string, taskIds: string[]) {
    this.ctx.bus.publish(userId, { type: 'tasks.changed', taskIds });
  }

  // ------------------------------------------------------------------ reads

  async list(userId: string, timeZone: string, q: ListTasksQuery): Promise<Page<TaskDTO>> {
    const d = dayContext(timeZone);
    const { key, dir } = resolveSort(q);
    const where = filterConditions(userId, q, d);
    if (q.cursor) where.push(keysetCondition(key, dir, decodeCursor(q.cursor, isKeysetCursor)));

    const { expr } = SORT_EXPR[key];
    const order = dir === 'asc' ? asc : desc;
    const rows = await this.db
      .select({ task: tasks, sortValue: sql<string>`(${expr})::text` })
      .from(tasks)
      .where(and(...where))
      .orderBy(order(expr), order(tasks.id))
      .limit(q.limit + 1);

    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: await hydrateTasks(
        this.db,
        page.map((r) => r.task),
      ),
      nextCursor: rows.length > q.limit && last ? encodeCursor({ v: last.sortValue, id: last.task.id }) : null,
    };
  }

  async get(userId: string, id: string): Promise<TaskDTO> {
    const row = await this.findOwned(this.db, userId, id);
    return (await hydrateTasks(this.db, [row]))[0]!;
  }

  async stats(userId: string, timeZone: string): Promise<TaskStatsDTO> {
    const d = dayContext(timeZone);
    const weekStart = startOfZonedWeek(d.now, timeZone);
    const base = and(eq(tasks.userId, userId), isNull(tasks.deletedAt));
    const openSql = sql`${tasks.status} <> 'done'`;

    const [counts] = await this.db
      .select({
        inbox: sql<number>`count(*) filter (where ${tasks.projectId} is null and ${openSql})`.mapWith(Number),
        today: sql<number>`count(*) filter (where ${openSql} and ${tasks.dueAt} < ${d.endOfToday})`.mapWith(Number),
        upcoming: sql<number>`count(*) filter (where ${openSql} and ${tasks.dueAt} >= ${d.endOfToday})`.mapWith(Number),
        overdue: sql<number>`count(*) filter (where ${openSql} and ${overdueCondition(d)})`.mapWith(Number),
        completedToday: sql<number>`count(*) filter (where ${tasks.completedAt} >= ${d.startOfToday})`.mapWith(Number),
        completedThisWeek: sql<number>`count(*) filter (where ${tasks.completedAt} >= ${weekStart})`.mapWith(Number),
      })
      .from(tasks)
      .where(base);

    const byProjectRows = await this.db
      .select({ projectId: tasks.projectId, n: sql<number>`count(*)`.mapWith(Number) })
      .from(tasks)
      .where(and(base, ne(tasks.status, 'done'), isNotNull(tasks.projectId)))
      .groupBy(tasks.projectId);

    // Distinct local calendar days with a completion over the last year.
    const dayRows = rowsOf<{ day: string }>(
      await this.db.execute(sql`
        select distinct to_char(${tasks.completedAt} at time zone ${timeZone}, 'YYYY-MM-DD') as day
        from ${tasks}
        where ${tasks.userId} = ${userId} and ${tasks.completedAt} >= now() - interval '366 days'
        order by day desc`),
    );

    return {
      inbox: counts?.inbox ?? 0,
      today: counts?.today ?? 0,
      upcoming: counts?.upcoming ?? 0,
      overdue: counts?.overdue ?? 0,
      completedToday: counts?.completedToday ?? 0,
      completedThisWeek: counts?.completedThisWeek ?? 0,
      streakDays: computeStreak(
        dayRows.map((r) => r.day),
        d.now,
        timeZone,
      ),
      byProject: Object.fromEntries(byProjectRows.map((r) => [r.projectId!, r.n])),
    };
  }

  // ----------------------------------------------------------------- writes

  async create(userId: string, input: CreateTask, meta: RequestMeta): Promise<TaskDTO> {
    const task = await this.db.transaction(async (tx) => {
      if (input.projectId) await this.assertProject(tx, userId, input.projectId);
      const position = await this.nextPosition(tx, userId);
      const [row] = await tx
        .insert(tasks)
        .values({
          userId,
          title: input.title,
          description: input.description ?? null,
          status: input.status,
          priority: priorityToRank(input.priority),
          projectId: input.projectId ?? null,
          dueAt: date(input.dueAt) ?? null,
          allDay: input.allDay,
          remindAt: date(input.remindAt) ?? null,
          recurrence: input.recurrence ?? null,
          completedAt: input.status === 'done' ? new Date() : null,
          position,
        })
        .returning();
      if (input.tags?.length) await this.setTags(tx, userId, row!.id, input.tags);
      if (input.subtasks?.length) {
        await tx.insert(subtasks).values(input.subtasks.map((title, i) => ({ taskId: row!.id, title, position: i + 1 })));
      }
      return row!;
    });

    await this.ctx.audit.record({ action: 'task.create', userId, entityType: 'task', entityId: task.id, meta });
    this.changed(userId, [task.id]);
    return (await hydrateTasks(this.db, [task]))[0]!;
  }

  async update(userId: string, timeZone: string, id: string, input: UpdateTask, meta: RequestMeta): Promise<TaskMutationResult> {
    const result = await this.db.transaction(async (tx) => {
      const current = await this.findOwned(tx, userId, id, { forUpdate: true });
      if (current.deletedAt) throw AppError.conflict('This task is in the trash. Restore it before editing.');
      if (input.version !== undefined && input.version !== current.version) {
        throw AppError.conflict('This task was changed somewhere else. Refresh to see the latest version.');
      }
      if (input.projectId) await this.assertProject(tx, userId, input.projectId);

      const patch: Partial<NewTask> = {};
      if (input.title !== undefined) patch.title = input.title;
      if (input.description !== undefined) patch.description = input.description;
      if (input.priority !== undefined) patch.priority = priorityToRank(input.priority);
      if (input.projectId !== undefined) patch.projectId = input.projectId;
      if (input.allDay !== undefined) patch.allDay = input.allDay;
      if (input.position !== undefined) patch.position = input.position;
      if (input.recurrence !== undefined) patch.recurrence = input.recurrence;
      if (input.dueAt !== undefined) {
        patch.dueAt = date(input.dueAt);
        patch.overdueNotifiedAt = null; // re-arm overdue notification
      }
      if (input.remindAt !== undefined) {
        patch.remindAt = date(input.remindAt);
        patch.reminderSentAt = null; // re-arm reminder
      }

      const completing = input.status === 'done' && current.status !== 'done';
      if (input.status !== undefined) {
        patch.status = input.status;
        if (completing) patch.completedAt = new Date();
        if (input.status !== 'done') patch.completedAt = null;
      }

      const effectiveDue = patch.dueAt !== undefined ? patch.dueAt : current.dueAt;
      const effectiveRecurrence = patch.recurrence !== undefined ? patch.recurrence : current.recurrence;
      if (effectiveRecurrence && !effectiveDue) {
        throw AppError.badRequest('Recurring tasks need a due date', [{ path: 'recurrence', message: 'Set a due date first' }]);
      }

      const [updated] = await tx
        .update(tasks)
        .set({ ...patch, version: sql`${tasks.version} + 1` })
        .where(and(eq(tasks.id, id), eq(tasks.userId, userId)))
        .returning();
      if (input.tags !== undefined) await this.setTags(tx, userId, id, input.tags);

      let next: Task | undefined;
      let final = updated!;
      if (completing && updated!.recurrence && updated!.dueAt) {
        next = await this.spawnNextOccurrence(tx, updated!, timeZone);
        final = { ...updated!, recurrence: null }; // the rule moved to the new instance
      }
      return { updated: final, next };
    });

    await this.ctx.audit.record({
      action: input.status === 'done' ? 'task.complete' : 'task.update',
      userId,
      entityType: 'task',
      entityId: id,
      metadata: { fields: Object.keys(input).filter((k) => k !== 'version') },
      meta,
    });
    const hydrated = await hydrateTasks(this.db, result.next ? [result.updated, result.next] : [result.updated]);
    this.changed(userId, hydrated.map((t) => t.id));
    return { task: hydrated[0]!, ...(hydrated[1] ? { nextOccurrence: hydrated[1] } : {}) };
  }

  async remove(userId: string, id: string, permanent: boolean, meta: RequestMeta): Promise<void> {
    const current = await this.findOwned(this.db, userId, id);
    if (permanent) {
      if (!current.deletedAt) throw AppError.conflict('Move the task to the trash before deleting it permanently.');
      await this.db.delete(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
    } else {
      await this.db
        .update(tasks)
        .set({ deletedAt: new Date(), version: sql`${tasks.version} + 1` })
        .where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
    }
    await this.ctx.audit.record({ action: permanent ? 'task.purge' : 'task.delete', userId, entityType: 'task', entityId: id, meta });
    this.changed(userId, [id]);
  }

  async restore(userId: string, id: string, meta: RequestMeta): Promise<TaskDTO> {
    await this.findOwned(this.db, userId, id);
    const [row] = await this.db
      .update(tasks)
      .set({ deletedAt: null, version: sql`${tasks.version} + 1` })
      .where(and(eq(tasks.id, id), eq(tasks.userId, userId)))
      .returning();
    await this.ctx.audit.record({ action: 'task.restore', userId, entityType: 'task', entityId: id, meta });
    this.changed(userId, [id]);
    return (await hydrateTasks(this.db, [row!]))[0]!;
  }

  async emptyTrash(userId: string, meta: RequestMeta): Promise<number> {
    const deleted = await this.db
      .delete(tasks)
      .where(and(eq(tasks.userId, userId), isNotNull(tasks.deletedAt)))
      .returning({ id: tasks.id });
    await this.ctx.audit.record({ action: 'task.empty_trash', userId, metadata: { count: deleted.length }, meta });
    this.changed(userId, deleted.map((d) => d.id));
    return deleted.length;
  }

  async bulk(userId: string, timeZone: string, input: BulkTaskInput, meta: RequestMeta): Promise<{ updated: number }> {
    const ids = Array.from(new Set(input.ids));
    const owned = and(eq(tasks.userId, userId), inArray(tasks.id, ids), isNull(tasks.deletedAt));
    const bump = { version: sql`${tasks.version} + 1` };

    const affected = await this.db.transaction(async (tx) => {
      switch (input.action) {
        case 'complete': {
          const rows = await tx
            .update(tasks)
            .set({ status: 'done', completedAt: new Date(), ...bump })
            .where(and(owned, ne(tasks.status, 'done')))
            .returning();
          for (const r of rows) if (r.recurrence && r.dueAt) await this.spawnNextOccurrence(tx, r, timeZone);
          return rows.length;
        }
        case 'reopen':
          return (
            await tx
              .update(tasks)
              .set({ status: 'todo', completedAt: null, ...bump })
              .where(and(owned, eq(tasks.status, 'done')))
              .returning({ id: tasks.id })
          ).length;
        case 'delete':
          return (await tx.update(tasks).set({ deletedAt: new Date(), ...bump }).where(owned).returning({ id: tasks.id })).length;
        case 'move':
          if (input.projectId) await this.assertProject(tx, userId, input.projectId);
          return (await tx.update(tasks).set({ projectId: input.projectId, ...bump }).where(owned).returning({ id: tasks.id }))
            .length;
        case 'priority':
          return (
            await tx
              .update(tasks)
              .set({ priority: priorityToRank(input.priority), ...bump })
              .where(owned)
              .returning({ id: tasks.id })
          ).length;
      }
    });

    await this.ctx.audit.record({ action: `task.bulk_${input.action}`, userId, metadata: { count: affected, ids }, meta });
    this.changed(userId, ids);
    return { updated: affected };
  }

  // --------------------------------------------------------------- subtasks

  async addSubtask(userId: string, taskId: string, title: string): Promise<SubtaskDTO> {
    await this.findOwned(this.db, userId, taskId);
    const [{ count, maxPos } = { count: 0, maxPos: 0 }] = await this.db
      .select({ count: sql<number>`count(*)`.mapWith(Number), maxPos: max(subtasks.position) })
      .from(subtasks)
      .where(eq(subtasks.taskId, taskId));
    if (count >= LIMITS.subtasksPerTask) throw AppError.badRequest(`A task can have at most ${LIMITS.subtasksPerTask} subtasks.`);
    const [row] = await this.db
      .insert(subtasks)
      .values({ taskId, title, position: (maxPos ?? 0) + 1 })
      .returning();
    await this.touch(taskId);
    this.changed(userId, [taskId]);
    return toSubtaskDTO(row!);
  }

  async updateSubtask(
    userId: string,
    taskId: string,
    subtaskId: string,
    input: { title?: string; done?: boolean; position?: number },
  ): Promise<SubtaskDTO> {
    await this.findOwned(this.db, userId, taskId);
    const [row] = await this.db
      .update(subtasks)
      .set(input)
      .where(and(eq(subtasks.id, subtaskId), eq(subtasks.taskId, taskId)))
      .returning();
    if (!row) throw AppError.notFound('Subtask');
    await this.touch(taskId);
    this.changed(userId, [taskId]);
    return toSubtaskDTO(row);
  }

  async deleteSubtask(userId: string, taskId: string, subtaskId: string): Promise<void> {
    await this.findOwned(this.db, userId, taskId);
    const deleted = await this.db
      .delete(subtasks)
      .where(and(eq(subtasks.id, subtaskId), eq(subtasks.taskId, taskId)))
      .returning({ id: subtasks.id });
    if (!deleted.length) throw AppError.notFound('Subtask');
    await this.touch(taskId);
    this.changed(userId, [taskId]);
  }

  // ---------------------------------------------------------------- helpers

  /** Ownership is enforced in the WHERE clause: other users' tasks are indistinguishable from missing ones. */
  private async findOwned(db: DbOrTx, userId: string, id: string, opts: { forUpdate?: boolean } = {}): Promise<Task> {
    const q = db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
    const [row] = opts.forUpdate ? await q.for('update') : await q;
    if (!row) throw AppError.notFound('Task');
    return row;
  }

  private async assertProject(db: DbOrTx, userId: string, projectId: string): Promise<void> {
    const [p] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
    if (!p) throw AppError.badRequest('Project not found', [{ path: 'projectId', message: 'Project not found' }]);
  }

  private async nextPosition(db: DbOrTx, userId: string): Promise<number> {
    const [r] = await db.select({ m: max(tasks.position) }).from(tasks).where(eq(tasks.userId, userId));
    return Math.max((r?.m ?? 0) + 1024, Date.now());
  }

  private async touch(taskId: string) {
    await this.db
      .update(tasks)
      .set({ version: sql`${tasks.version} + 1` })
      .where(eq(tasks.id, taskId));
  }

  /** Replace a task's tags, creating any that don't exist yet (idempotent upsert). */
  private async setTags(db: DbOrTx, userId: string, taskId: string, names: string[]): Promise<void> {
    await db.delete(taskTags).where(eq(taskTags.taskId, taskId));
    if (!names.length) return;
    await db
      .insert(tags)
      .values(names.map((name) => ({ userId, name })))
      .onConflictDoNothing({ target: [tags.userId, tags.name] });
    const rows = await db
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.userId, userId), inArray(tags.name, names)));
    await db.insert(taskTags).values(rows.map((r) => ({ taskId, tagId: r.id })));
  }

  /** Create the next instance of a recurring task (tags + fresh subtasks carried over). */
  private async spawnNextOccurrence(db: DbOrTx, done: Task, timeZone: string): Promise<Task> {
    // All-day tasks due today aren't late until the day ends, so today's occurrence is
    // still eligible: compare against local midnight rather than the current instant.
    const now = new Date();
    const threshold = done.allDay ? new Date(startOfZonedDay(now, timeZone).getTime() - 1) : now;
    const nextDue = nextOccurrence(done.dueAt!, done.recurrence!, threshold, timeZone);
    const shift = nextDue.getTime() - done.dueAt!.getTime();
    const [created] = await db
      .insert(tasks)
      .values({
        userId: done.userId,
        projectId: done.projectId,
        title: done.title,
        description: done.description,
        priority: done.priority,
        allDay: done.allDay,
        recurrence: done.recurrence,
        dueAt: nextDue,
        remindAt: done.remindAt ? new Date(done.remindAt.getTime() + shift) : null,
        position: done.position,
      })
      .returning();
    // The completed instance no longer recurs — the new one carries the rule forward.
    await db.update(tasks).set({ recurrence: null }).where(eq(tasks.id, done.id));

    const tagRows = await db.select({ tagId: taskTags.tagId }).from(taskTags).where(eq(taskTags.taskId, done.id));
    if (tagRows.length) await db.insert(taskTags).values(tagRows.map((t) => ({ taskId: created!.id, tagId: t.tagId })));
    const subs = await db.select().from(subtasks).where(eq(subtasks.taskId, done.id)).orderBy(asc(subtasks.position));
    if (subs.length) {
      await db.insert(subtasks).values(subs.map((s) => ({ taskId: created!.id, title: s.title, position: s.position })));
    }
    return created!;
  }
}

/** Consecutive days with a completion, ending today (or yesterday, so the streak survives until midnight). */
export function computeStreak(daysDesc: string[], now: Date, timeZone: string): number {
  if (!daysDesc.length) return 0;
  const set = new Set(daysDesc);
  const key = (offsetDays: number) => zonedDateKey(new Date(now.getTime() - offsetDays * 86_400_000), timeZone);
  let offset = set.has(key(0)) ? 0 : set.has(key(1)) ? 1 : -1;
  if (offset < 0) return 0;
  let streak = 0;
  while (set.has(key(offset))) {
    streak++;
    offset++;
  }
  return streak;
}
