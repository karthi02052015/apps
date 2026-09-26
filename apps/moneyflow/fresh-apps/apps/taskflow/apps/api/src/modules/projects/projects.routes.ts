import { Router } from 'express';
import { z } from 'zod';
import { createProjectSchema, updateProjectSchema } from '@taskflow/shared';
import type { AppContext } from '../../context';
import { requestMeta } from '../../lib/http';
import { authed } from '../../middleware/auth';
import { parse } from '../../middleware/validate';
import { ProjectsService } from './projects.service';

export function projectsRouter(ctx: AppContext): Router {
  const router = Router();
  const service = new ProjectsService(ctx);
  const idParam = z.uuid({ message: 'Invalid id' });

  router.get('/', async (req, res) => {
    res.json({ items: await service.list(authed(req).userId, req.query.includeArchived === 'true') });
  });

  router.post('/', async (req, res) => {
    const input = parse(createProjectSchema, req.body);
    res.status(201).json({ project: await service.create(authed(req).userId, input, requestMeta(req)) });
  });

  router.patch('/:id', async (req, res) => {
    const input = parse(updateProjectSchema, req.body);
    res.json({ project: await service.update(authed(req).userId, parse(idParam, req.params.id), input, requestMeta(req)) });
  });

  router.delete('/:id', async (req, res) => {
    await service.remove(authed(req).userId, parse(idParam, req.params.id), requestMeta(req));
    res.status(204).end();
  });

  return router;
}
