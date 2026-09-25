import { eq } from 'drizzle-orm';
import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  bulkTaskSchema,
  createSubtaskSchema,
  createTaskSchema,
  listTasksQuerySchema,
  updateSubtaskSchema,
  updateTaskSchema,
} from '@taskflow/shared';
import type { AppContext } from '../../context';
import { users } from '../../db/schema';
import { requestMeta } from '../../lib/http';
import { authed } from '../../middleware/auth';
import { parse } from '../../middleware/validate';
import { TasksService } from './tasks.service';

const idParam = z.uuid({ message: 'Invalid id' });

/**
 * Day boundaries ("Today", overdue, recurrence) follow the device zone sent in
 * X-Timezone, falling back to the zone saved on the profile (API clients).
 */
async function timeZoneOf(ctx: AppContext, req: Request): Promise<string> {
  if (req.timeZone) return req.timeZone;
  const [u] = await ctx.db.select({ tz: users.timezone }).from(users).where(eq(users.id, authed(req).userId));
  return u?.tz ?? 'UTC';
}

export function tasksRouter(ctx: AppContext): Router {
  const router = Router();
  const service = new TasksService(ctx);

  router.get('/', async (req, res) => {
    const q = parse(listTasksQuerySchema, req.query);
    res.json(await service.list(authed(req).userId, await timeZoneOf(ctx, req), q));
  });

  router.get('/stats', async (req, res) => {
    res.json(await service.stats(authed(req).userId, await timeZoneOf(ctx, req)));
  });

  router.post('/', async (req, res) => {
    const input = parse(createTaskSchema, req.body);
    res.status(201).json({ task: await service.create(authed(req).userId, input, requestMeta(req)) });
  });

  router.post('/bulk', async (req, res) => {
    const input = parse(bulkTaskSchema, req.body);
    res.json(await service.bulk(authed(req).userId, await timeZoneOf(ctx, req), input, requestMeta(req)));
  });

  router.delete('/trash', async (req, res) => {
    res.json({ deleted: await service.emptyTrash(authed(req).userId, requestMeta(req)) });
  });

  router.get('/:id', async (req, res) => {
    res.json({ task: await service.get(authed(req).userId, parse(idParam, req.params.id)) });
  });

  router.patch('/:id', async (req, res) => {
    const input = parse(updateTaskSchema, req.body);
    const id = parse(idParam, req.params.id);
    res.json(await service.update(authed(req).userId, await timeZoneOf(ctx, req), id, input, requestMeta(req)));
  });

  router.delete('/:id', async (req, res) => {
    const permanent = req.query.permanent === 'true';
    await service.remove(authed(req).userId, parse(idParam, req.params.id), permanent, requestMeta(req));
    res.status(204).end();
  });

  router.post('/:id/restore', async (req, res) => {
    res.json({ task: await service.restore(authed(req).userId, parse(idParam, req.params.id), requestMeta(req)) });
  });

  router.post('/:id/subtasks', async (req, res) => {
    const { title } = parse(createSubtaskSchema, req.body);
    res.status(201).json({ subtask: await service.addSubtask(authed(req).userId, parse(idParam, req.params.id), title) });
  });

  router.patch('/:id/subtasks/:subtaskId', async (req, res) => {
    const input = parse(updateSubtaskSchema, req.body);
    const subtask = await service.updateSubtask(
      authed(req).userId,
      parse(idParam, req.params.id),
      parse(idParam, req.params.subtaskId),
      input,
    );
    res.json({ subtask });
  });

  router.delete('/:id/subtasks/:subtaskId', async (req, res) => {
    await service.deleteSubtask(authed(req).userId, parse(idParam, req.params.id), parse(idParam, req.params.subtaskId));
    res.status(204).end();
  });

  return router;
}
