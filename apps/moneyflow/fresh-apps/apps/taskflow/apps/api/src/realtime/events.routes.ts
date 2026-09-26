import { and, eq, gt, isNull } from 'drizzle-orm';
import { Router } from 'express';
import type { RealtimeEvent } from '@taskflow/shared';
import type { AppContext } from '../context';
import { sessions } from '../db/schema';
import { AppError } from '../lib/errors';
import { authed, requireAuth } from '../middleware/auth';
import { metrics } from '../observability/metrics';

const MAX_STREAMS_PER_USER = 10;
const HEARTBEAT_MS = 25_000;

/**
 * GET /api/v1/events — Server-Sent Events stream.
 * Clients read it with fetch() so the access token travels in the
 * Authorization header, never in the URL (which would leak into logs).
 * The stream closes when the access token expires; the client reconnects
 * with a fresh token.
 */
export function eventsRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/', requireAuth(ctx.env), async (req, res) => {
    const { userId, exp, sessionId } = authed(req);
    if (ctx.bus.listenerCount(userId) >= MAX_STREAMS_PER_USER) {
      throw new AppError(429, 'RATE_LIMITED', 'Too many open realtime connections.');
    }
    // Long-lived stream: confirm the session is still live rather than trusting the JWT alone.
    const [live] = await ctx.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())));
    if (!live) throw AppError.unauthenticated('Your session has ended. Please sign in again.');

    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable proxy buffering (nginx)
    });
    res.flushHeaders();

    const send = (event: RealtimeEvent) => {
      if (event.type === 'session.revoked') {
        const hit = event.sessionIds === 'all' ? event.except !== sessionId : event.sessionIds.includes(sessionId);
        if (hit) res.end();
        return;
      }
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    res.write('retry: 5000\n\n');
    send({ type: 'ping' });

    const unsubscribe = ctx.bus.subscribe(userId, send);
    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), HEARTBEAT_MS);
    const msUntilExpiry = Math.max(exp * 1000 - Date.now(), 1_000);
    const expiry = setTimeout(() => res.end(), msUntilExpiry);
    metrics.sseConnections.inc();

    const cleanup = () => {
      clearInterval(heartbeat);
      clearTimeout(expiry);
      unsubscribe();
      metrics.sseConnections.dec();
    };
    req.on('close', cleanup);
  });

  return router;
}
