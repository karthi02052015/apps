import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import type { AppContext } from '../context';
import { registry } from './metrics';

const startedAt = Date.now();

export function healthRouter(ctx: AppContext): Router {
  const router = Router();

  /** Liveness: the process is up. Never touches dependencies. */
  router.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) });
  });

  /** Readiness: can we serve traffic (database reachable)? */
  router.get('/readyz', async (_req, res) => {
    try {
      await Promise.race([
        ctx.database.ping(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('db ping timeout')), 2_000)),
      ]);
      res.json({ status: 'ready', database: ctx.database.kind });
    } catch (err) {
      ctx.logger.warn({ err }, 'readiness check failed');
      res.status(503).json({ status: 'unavailable' });
    }
  });

  router.get('/metrics', async (req, res) => {
    const token = ctx.env.METRICS_TOKEN;
    if (!token && ctx.env.NODE_ENV === 'production') {
      // Never expose operational metrics publicly by accident.
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Metrics are disabled. Set METRICS_TOKEN to enable.' } });
      return;
    }
    if (token) {
      const given = Buffer.from(req.get('authorization')?.replace(/^Bearer /, '') ?? '');
      const want = Buffer.from(token);
      if (given.length !== want.length || !timingSafeEqual(given, want)) {
        res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Metrics token required.' } });
        return;
      }
    }
    res.set('Content-Type', registry.contentType).send(await registry.metrics());
  });

  return router;
}
