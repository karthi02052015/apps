import { and, eq, gte, inArray, isNotNull, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  priorityToRank,
  startOfZonedDay,
  type ListTasksQuery,
  type TaskSortField,
  type TaskView,
} from '@taskflow/shared';
import { tags, taskTags, tasks } from '../../db/schema';
import { col } from '../../db/sql';
import { AppError } from '../../lib/errors';
import { escapeLike } from '../../lib/http';

export interface DayContext {
  now: Date;
  startOfToday: Date;
  endOfToday: Date;
}

export const dayContext = (timeZone: string, now = new Date()): DayContext => ({
  now,
  startOfToday: startOfZonedDay(now, timeZone),
  endOfToday: startOfZonedDay(now, timeZone, 1),
});

/**
 * A task is overdue when an all-day task's date has passed, or a timed task's
 * moment has passed. (All-day due dates are stored as local midnight.)
 */
export const overdueCondition = (d: DayContext): SQL =>
  sql`((${tasks.allDay} and ${tasks.dueAt} < ${d.startOfToday}) or (not ${tasks.allDay} and ${tasks.dueAt} < ${d.now}))`;

const open = ne(tasks.status, 'done');

export function viewCondition(view: TaskView, d: DayContext, includeCompleted = false): SQL | undefined {
  const maybeOpen = includeCompleted ? undefined : open;
  switch (view) {
    case 'inbox':
      return and(isNull(tasks.projectId), maybeOpen);
    case 'today':
      // Open tasks due today or earlier, plus tasks finished today (so progress stays visible).
      return and(
        lt(tasks.dueAt, d.endOfToday),
        or(open, and(eq(tasks.status, 'done'), gte(tasks.completedAt, d.startOfToday))),
      );
    case 'upcoming':
      return and(gte(tasks.dueAt, d.endOfToday), maybeOpen);
    case 'overdue':
      return and(overdueCondition(d), open);
    case 'completed':
      return eq(tasks.status, 'done');
    case 'trash':
      return undefined;
    case 'all':
    default:
      return maybeOpen;
  }
}

export type SortKey = TaskSortField | 'completedAt' | 'deletedAt';

/** Sort expressions plus the SQL type used to cast cursor values back. */
export const SORT_EXPR: Record<SortKey, { expr: SQL; type: string }> = {
  position: { expr: sql`${tasks.position}`, type: 'double precision' },
  dueAt: { expr: sql`coalesce(${tasks.dueAt}, 'infinity'::timestamptz)`, type: 'timestamptz' },
  priority: { expr: sql`${tasks.priority}`, type: 'smallint' },
  createdAt: { expr: sql`${tasks.createdAt}`, type: 'timestamptz' },
  updatedAt: { expr: sql`${tasks.updatedAt}`, type: 'timestamptz' },
  title: { expr: sql`lower(${tasks.title})`, type: 'text' },
  completedAt: { expr: sql`coalesce(${tasks.completedAt}, '-infinity'::timestamptz)`, type: 'timestamptz' },
  deletedAt: { expr: sql`coalesce(${tasks.deletedAt}, '-infinity'::timestamptz)`, type: 'timestamptz' },
};

export function resolveSort(q: Pick<ListTasksQuery, 'view' | 'sort' | 'order'>): { key: SortKey; dir: 'asc' | 'desc' } {
  // Sensible defaults per view unless the caller explicitly picked something else.
  if (q.sort === 'position') {
    if (q.view === 'completed') return { key: 'completedAt', dir: 'desc' };
    if (q.view === 'trash') return { key: 'deletedAt', dir: 'desc' };
    if (q.view === 'upcoming' || q.view === 'today' || q.view === 'overdue') return { key: 'dueAt', dir: 'asc' };
  }
  return { key: q.sort, dir: q.order };
}

export interface KeysetCursor {
  v: string;
  id: string;
}
export const isKeysetCursor = (v: unknown): v is KeysetCursor =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as KeysetCursor).v === 'string' &&
  typeof (v as KeysetCursor).id === 'string' &&
  /^[0-9a-f-]{36}$/i.test((v as KeysetCursor).id);

/** Postgres timestamptz text output, e.g. "2026-09-23 10:00:00.123+05:30". */
const PG_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2}){0,2}|Z)?$/;

/** Reject cursor values that can't be cast to the sort column's type (422, not a DB error). */
function assertCursorValue(key: SortKey, v: string): void {
  const { type } = SORT_EXPR[key];
  const ok =
    type === 'timestamptz'
      ? v === 'infinity' || v === '-infinity' || PG_TIMESTAMP_RE.test(v)
      : type === 'text'
        ? v.length <= 500
        : v.length <= 40 && Number.isFinite(Number(v));
  if (!ok) throw AppError.badRequest('Invalid pagination cursor', [{ path: 'cursor', message: 'Invalid cursor' }]);
}

/** Row-value comparison gives stable keyset pagination on (sort, id). */
export function keysetCondition(key: SortKey, dir: 'asc' | 'desc', c: KeysetCursor): SQL {
  assertCursorValue(key, c.v);
  const { expr, type } = SORT_EXPR[key];
  const op = sql.raw(dir === 'asc' ? '>' : '<');
  return sql`(${expr}, ${tasks.id}) ${op} (cast(${c.v} as ${sql.raw(type)}), cast(${c.id} as uuid))`;
}

export function filterConditions(userId: string, q: ListTasksQuery, d: DayContext): SQL[] {
  const where: SQL[] = [eq(tasks.userId, userId)];
  where.push(q.view === 'trash' ? isNotNull(tasks.deletedAt) : isNull(tasks.deletedAt));

  const view = viewCondition(q.view, d, q.includeCompleted);
  if (view) where.push(view);

  if (q.status?.length) where.push(inArray(tasks.status, q.status));
  if (q.priority?.length) where.push(inArray(tasks.priority, q.priority.map(priorityToRank)));
  if (q.projectId) where.push(eq(tasks.projectId, q.projectId));
  if (q.dueFrom) where.push(gte(tasks.dueAt, new Date(q.dueFrom)));
  if (q.dueTo) where.push(lt(tasks.dueAt, new Date(q.dueTo)));
  if (q.tag) {
    where.push(
      sql`exists (select 1 from ${taskTags} inner join ${tags} on ${col(tags.id)} = ${col(taskTags.tagId)}
                  where ${col(taskTags.taskId)} = ${col(tasks.id)} and ${col(tags.name)} = ${q.tag.toLowerCase()} and ${col(tags.userId)} = ${userId})`,
    );
  }
  if (q.q) {
    // Full-text (GIN-indexed) OR substring match so partial words still find results.
    const like = `%${escapeLike(q.q)}%`;
    where.push(
      sql`(${tasks.searchVector} @@ websearch_to_tsquery('simple', ${q.q}) or ${tasks.title} ilike ${like} escape '\\')`,
    );
  }
  return where;
}
