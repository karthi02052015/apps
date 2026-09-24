import { Router } from 'express';
import { z } from 'zod';
import { markNotificationsReadSchema, paginationQuerySchema } from '@taskflow/shared';
import type { AppContext } from '../../context';
import { authed } from '../../middleware/auth';
import { parse } from '../../middleware/validate';
import { NotificationsService } from './notifications.service';

const listQuery = paginationQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  unread: z.enum(['true', 'false']).optional(),
});

export function notificationsRouter(ctx: AppContext): Router {
  const router = Router();
  const service = new NotificationsService(ctx);

  router.get('/', async (req, res) => {
    const q = parse(listQuery, req.query);
    res.json(await service.list(authed(req).userId, { cursor: q.cursor, limit: q.limit, unreadOnly: q.unread === 'true' }));
  });

  router.post('/read', async (req, res) => {
    const input = parse(markNotificationsReadSchema, req.body);
    res.json({ updated: await service.markRead(authed(req).userId, input) });
  });

  return router;
}
