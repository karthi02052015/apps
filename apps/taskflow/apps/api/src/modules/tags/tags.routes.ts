import { and, asc, eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { createTagSchema, updateTagSchema, type TagDTO } from '@taskflow/shared';
import type { AppContext } from '../../context';
import { tags, taskTags, tasks } from '../../db/schema';
import { col } from '../../db/sql';
import { AppError } from '../../lib/errors';
import { requestMeta } from '../../lib/http';
import { authed } from '../../middleware/auth';
import { parse } from '../../middleware/validate';

/** Tags are small enough that a thin route layer over the query builder is clearer than a service. */
export function tagsRouter(ctx: AppContext): Router {
  const router = Router();
  const idParam = z.uuid({ message: 'Invalid id' });

  const taskCount = sql<number>`(
    select count(*) from ${taskTags} inner join ${tasks} on ${col(tasks.id)} = ${col(taskTags.taskId)}
    where ${col(taskTags.tagId)} = ${col(tags.id)} and ${col(tasks.deletedAt)} is null and ${col(tasks.status)} <> 'done'
  )`.mapWith(Number);

  const list = async (userId: string): Promise<TagDTO[]> =>
    (
      await ctx.db
        .select({ id: tags.id, name: tags.name, color: tags.color, taskCount })
        .from(tags)
        .where(eq(tags.userId, userId))
        .orderBy(asc(tags.name))
    ).map((t) => ({ ...t }));

  router.get('/', async (req, res) => {
    res.json({ items: await list(authed(req).userId) });
  });

  router.post('/', async (req, res) => {
    const { userId } = authed(req);
    const input = parse(createTagSchema, req.body);
    const [row] = await ctx.db
      .insert(tags)
      .values({ userId, name: input.name, ...(input.color ? { color: input.color } : {}) })
      .onConflictDoNothing()
      .returning();
    if (!row) throw AppError.conflict(`Tag "${input.name}" already exists.`);
    await ctx.audit.record({ action: 'tag.create', userId, entityType: 'tag', entityId: row.id, meta: requestMeta(req) });
    res.status(201).json({ tag: { id: row.id, name: row.name, color: row.color, taskCount: 0 } });
  });

  router.patch('/:id', async (req, res) => {
    const { userId } = authed(req);
    const input = parse(updateTagSchema, req.body);
    const [row] = await ctx.db
      .update(tags)
      .set(input)
      .where(and(eq(tags.id, parse(idParam, req.params.id)), eq(tags.userId, userId)))
      .returning();
    if (!row) throw AppError.notFound('Tag');
    ctx.bus.publish(userId, { type: 'tasks.changed', taskIds: [] });
    res.json({ tag: (await list(userId)).find((t) => t.id === row.id) });
  });

  router.delete('/:id', async (req, res) => {
    const { userId } = authed(req);
    const id = parse(idParam, req.params.id);
    const deleted = await ctx.db
      .delete(tags)
      .where(and(eq(tags.id, id), eq(tags.userId, userId)))
      .returning({ id: tags.id });
    if (!deleted.length) throw AppError.notFound('Tag');
    await ctx.audit.record({ action: 'tag.delete', userId, entityType: 'tag', entityId: id, meta: requestMeta(req) });
    ctx.bus.publish(userId, { type: 'tasks.changed', taskIds: [] });
    res.status(204).end();
  });

  return router;
}
