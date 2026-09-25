import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { canonicalTimeZone, type UserRole } from '@taskflow/shared';
import type { Env } from '../config/env';
import { AppError } from '../lib/errors';
import { verifyAccessToken } from '../lib/tokens';

export function requireAuth(env: Env): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const header = req.get('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    if (!token) return next(AppError.unauthenticated());
    const claims = verifyAccessToken(env, token);
    if (!claims) return next(AppError.unauthenticated('Your session has expired. Please sign in again.'));
    req.auth = { userId: claims.sub, role: claims.role, sessionId: claims.sid, exp: claims.exp };
    next();
  };
}

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(AppError.unauthenticated());
    if (!roles.includes(req.auth.role)) return next(AppError.forbidden());
    next();
  };
}

/**
 * CSRF defence for cookie-authenticated endpoints (refresh/logout). Browsers
 * cannot attach custom headers cross-site without a CORS preflight, which our
 * allow-list rejects. Combined with SameSite=Strict cookies this is robust.
 */
export const requireCsrfHeader: RequestHandler = (req, _res, next) => {
  if (req.get('x-requested-with') !== 'taskflow') return next(AppError.forbidden('Missing CSRF header.'));
  next();
};

/** Capture the device time zone from the X-Timezone header when it is valid. */
export const resolveTimeZone: RequestHandler = (req, _res, next) => {
  const tz = req.get('x-timezone');
  // Canonicalise (bounded set of ~600 zones) so arbitrary spellings can't grow caches.
  const canonical = tz ? canonicalTimeZone(tz) : null;
  if (canonical) req.timeZone = canonical;
  next();
};

export const authed = (req: Request) => {
  if (!req.auth) throw AppError.unauthenticated();
  return req.auth;
};
