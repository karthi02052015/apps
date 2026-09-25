import { Router } from 'express';
import { z } from 'zod';
import { paginationQuerySchema } from '@taskflow/shared';
import type { AppContext } from '../../context';
import { authed } from '../../middleware/auth';
import { parse } from '../../middleware/validate';

const querySchema = paginationQuerySchema.extend({
  action: z.string().max(64).optional(),
  /** Admins may inspect any user; everyone else is pinned to themselves. */
  userId: z.uuid().optional(),
});

export function auditRouter(ctx: AppContext): Router {
  const router = Router();
  router.get('/', async (req, res) => {
    const auth = authed(req);
    const q = parse(querySchema, req.query);
    const userId = auth.role === 'admin' ? q.userId : auth.userId;
    res.json(await ctx.audit.list({ userId, action: q.action, cursor: q.cursor, limit: q.limit }));
  });
  return router;
}
