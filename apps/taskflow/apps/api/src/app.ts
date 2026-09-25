import path from 'node:path';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'node:crypto';
import { corsOrigins } from './config/env';
import type { AppContext } from './context';
import { requireAuth, resolveTimeZone } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { createRateLimiters } from './middleware/rateLimit';
import { auditRouter } from './modules/audit/audit.routes';
import { authRouter } from './modules/auth/auth.routes';
import { notificationsRouter } from './modules/notifications/notifications.routes';
import { projectsRouter } from './modules/projects/projects.routes';
import { tagsRouter } from './modules/tags/tags.routes';
import { tasksRouter } from './modules/tasks/tasks.routes';
import { healthRouter } from './observability/health.routes';
import { metrics } from './observability/metrics';
import { eventsRouter } from './realtime/events.routes';

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,64}$/;

export function createApp(ctx: AppContext): Express {
  const app = express();
  const { env, logger } = ctx;

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);
  app.set('query parser', 'extended');

  // Correlation id: honour a well-formed upstream id, otherwise mint one.
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      autoLogging: { ignore: (req) => req.url === '/healthz' || req.url === '/readyz' || req.url === '/metrics' },
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: env.COOKIE_SECURE ? [] : null,
        },
      },
      // HSTS only makes sense when served over HTTPS.
      strictTransportSecurity: env.COOKIE_SECURE ? { maxAge: 31_536_000, includeSubDomains: true } : false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  const allowed = new Set(corsOrigins(env));
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || allowed.has(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Timezone', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
      maxAge: 600,
    }),
  );

  app.use(
    compression({
      // SSE must stream unbuffered.
      filter: (req, res) => !String(res.getHeader('Content-Type') ?? '').includes('text/event-stream') && compression.filter(req, res),
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // Latency histogram labelled by route template (not raw URL) to keep cardinality bounded.
  app.use((req, res, next) => {
    const end = metrics.httpDuration.startTimer();
    res.on('finish', () => {
      const route = req.route?.path ? `${req.baseUrl}${String(req.route.path)}` : 'unmatched';
      end({ method: req.method, route, status: String(res.statusCode) });
    });
    next();
  });

  app.use(healthRouter(ctx));

  const limiters = createRateLimiters(env);
  const api = express.Router();
  api.use(limiters.api);
  api.use(resolveTimeZone);
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  api.use('/auth', authRouter(ctx, limiters));
  api.use('/events', eventsRouter(ctx));
  api.use(requireAuth(env));
  api.use('/tasks', tasksRouter(ctx));
  api.use('/projects', projectsRouter(ctx));
  api.use('/tags', tagsRouter(ctx));
  api.use('/notifications', notificationsRouter(ctx));
  api.use('/audit-logs', auditRouter(ctx));
  app.use('/api/v1', api);
  app.use('/api', notFoundHandler);

  // Optional single-container mode: serve the built SPA with history fallback.
  if (env.WEB_DIST_DIR) {
    const dist = path.resolve(env.WEB_DIST_DIR);
    app.use(
      '/assets',
      express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y', index: false }),
    );
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.set('Cache-Control', 'no-cache').sendFile(path.join(dist, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
