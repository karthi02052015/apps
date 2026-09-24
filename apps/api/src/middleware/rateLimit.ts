import { rateLimit, type Options } from 'express-rate-limit';
import type { Env } from '../config/env';

/**
 * In-memory stores are correct for a single instance. For horizontal scaling
 * plug a shared store (e.g. rate-limit-redis) in via `store` — see DEPLOYMENT.md.
 */
const base = (overrides: Partial<Options>): ReturnType<typeof rateLimit> =>
  rateLimit({
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res, _next, options) => {
      res.status(options.statusCode).json({
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down and try again shortly.' },
      });
    },
    ...overrides,
  });

export const createRateLimiters = (env: Env) => {
  const skip = () => env.NODE_ENV === 'test';
  return {
    api: base({ windowMs: env.RATE_LIMIT_WINDOW_MS, limit: env.RATE_LIMIT_MAX, skip }),
    /** Credential endpoints: strict per-IP budget to slow brute force & stuffing. */
    auth: base({ windowMs: 15 * 60_000, limit: env.AUTH_RATE_LIMIT_MAX, skip, skipSuccessfulRequests: true }),
    refresh: base({ windowMs: 60_000, limit: 30, skip }),
  };
};
