import type { CookieOptions, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
  type AuthResponse,
} from '@taskflow/shared';
import type { AppContext } from '../../context';
import { requestMeta } from '../../lib/http';
import { authed, requireAuth, requireCsrfHeader } from '../../middleware/auth';
import type { createRateLimiters } from '../../middleware/rateLimit';
import { parse } from '../../middleware/validate';
import { AuthService, type IssuedSession } from './auth.service';

export const REFRESH_COOKIE = 'tf_rt';
const COOKIE_PATH = '/api/v1/auth';

export function authRouter(ctx: AppContext, limiters: ReturnType<typeof createRateLimiters>): Router {
  const router = Router();
  const service = new AuthService(ctx);

  const cookieOptions = (expires?: Date): CookieOptions => ({
    httpOnly: true, // unreadable from JS → immune to XSS token theft
    secure: ctx.env.COOKIE_SECURE,
    sameSite: 'strict',
    path: COOKIE_PATH, // only ever sent to auth endpoints
    ...(expires ? { expires } : {}),
  });

  const respond = (res: Response, issued: Omit<IssuedSession, 'refreshToken'> & { refreshToken: string | null }, status = 200) => {
    if (issued.refreshToken) res.cookie(REFRESH_COOKIE, issued.refreshToken, cookieOptions(issued.refreshExpiresAt));
    res.set('Cache-Control', 'no-store');
    const body: AuthResponse = { user: issued.user, accessToken: issued.accessToken, expiresIn: issued.expiresIn };
    res.status(status).json(body);
  };

  const readCookie = (req: Request): string | undefined => {
    const v: unknown = req.cookies?.[REFRESH_COOKIE];
    return typeof v === 'string' && v.length > 0 && v.length < 200 ? v : undefined;
  };

  router.post('/register', limiters.auth, async (req, res) => {
    const input = parse(registerSchema, req.body);
    respond(res, await service.register(input, requestMeta(req)), 201);
  });

  router.post('/login', limiters.auth, async (req, res) => {
    const input = parse(loginSchema, req.body);
    respond(res, await service.login(input, requestMeta(req)));
  });

  router.post('/refresh', limiters.refresh, requireCsrfHeader, async (req, res) => {
    try {
      respond(res, await service.refresh(readCookie(req), requestMeta(req)));
    } catch (err) {
      res.clearCookie(REFRESH_COOKIE, cookieOptions());
      throw err;
    }
  });

  router.post('/logout', requireCsrfHeader, async (req, res) => {
    await service.logout(readCookie(req), requestMeta(req));
    res.clearCookie(REFRESH_COOKIE, cookieOptions());
    res.status(204).end();
  });

  // ---- Authenticated ----
  router.use(requireAuth(ctx.env));

  router.get('/me', async (req, res) => {
    res.json({ user: await service.me(authed(req).userId) });
  });

  router.patch('/me', async (req, res) => {
    const input = parse(updateProfileSchema, req.body);
    res.json({ user: await service.updateProfile(authed(req).userId, input, requestMeta(req)) });
  });

  router.post('/change-password', limiters.auth, async (req, res) => {
    const { userId, sessionId } = authed(req);
    await service.changePassword(userId, sessionId, parse(changePasswordSchema, req.body), requestMeta(req));
    res.status(204).end();
  });

  router.post('/logout-all', async (req, res) => {
    await service.logoutAll(authed(req).userId, requestMeta(req));
    res.clearCookie(REFRESH_COOKIE, cookieOptions());
    res.status(204).end();
  });

  router.get('/sessions', async (req, res) => {
    const { userId, sessionId } = authed(req);
    res.json({ items: await service.listSessions(userId, sessionId) });
  });

  router.delete('/sessions/:id', async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    await service.revokeSession(authed(req).userId, id, requestMeta(req));
    res.status(204).end();
  });

  return router;
}
