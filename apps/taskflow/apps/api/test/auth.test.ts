import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, sessions } from '../src/db/schema';
import { hashToken } from '../src/lib/tokens';
import { bearer, createTestApp, refreshCookie, registerUser, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());

const csrf = { 'X-Requested-With': 'taskflow' };

describe('registration', () => {
  it('creates an account, returns an access token and sets a hardened refresh cookie', async () => {
    const res = await request(t.app)
      .post('/api/v1/auth/register')
      .send({ name: 'Ada', email: 'Ada@Example.com', password: 'analytical-engine-1' })
      .expect(201);
    expect(res.body.user).toMatchObject({ email: 'ada@example.com', name: 'Ada', role: 'user' });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.accessToken).toBeTypeOf('string');
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('tf_rt='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
  });

  it('seeds starter content for new users', async () => {
    const u = await registerUser(t.app);
    const projects = await request(t.app).get('/api/v1/projects').set(bearer(u)).expect(200);
    expect(projects.body.items[0].name).toBe('Getting started');
    expect(projects.body.items[0].openTaskCount).toBeGreaterThan(0);
  });

  it('rejects duplicate emails case-insensitively', async () => {
    await request(t.app).post('/api/v1/auth/register').send({ name: 'A', email: 'dup@example.com', password: 'password-123' }).expect(201);
    const res = await request(t.app)
      .post('/api/v1/auth/register')
      .send({ name: 'B', email: 'DUP@example.com', password: 'password-123' })
      .expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('returns field-level validation errors', async () => {
    const res = await request(t.app).post('/api/v1/auth/register').send({ name: '', email: 'nope', password: 'short' }).expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['name', 'email', 'password']));
  });
});

describe('login', () => {
  it('signs in with correct credentials and rejects wrong ones with a generic message', async () => {
    const u = await registerUser(t.app);
    await request(t.app).post('/api/v1/auth/login').send({ email: u.email, password: u.password }).expect(200);
    const bad = await request(t.app).post('/api/v1/auth/login').send({ email: u.email, password: 'wrong-password-1' }).expect(401);
    const unknown = await request(t.app).post('/api/v1/auth/login').send({ email: 'ghost@example.com', password: 'whatever-123' }).expect(401);
    expect(bad.body.error.message).toBe(unknown.body.error.message); // no account enumeration
  });

  it('locks the account after repeated failures — even when attempts arrive in parallel', async () => {
    const u = await registerUser(t.app);
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        request(t.app).post('/api/v1/auth/login').send({ email: u.email, password: `bad-${i}-password` }),
      ),
    );
    const res = await request(t.app).post('/api/v1/auth/login').send({ email: u.email, password: u.password }).expect(423);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(res.headers['retry-after']).toBeDefined();
  });
});

describe('protected routes', () => {
  it('requires a valid bearer token', async () => {
    await request(t.app).get('/api/v1/auth/me').expect(401);
    await request(t.app).get('/api/v1/auth/me').set('Authorization', 'Bearer not-a-jwt').expect(401);
    const u = await registerUser(t.app);
    const me = await request(t.app).get('/api/v1/auth/me').set(bearer(u)).expect(200);
    expect(me.body.user.email).toBe(u.email);
  });

  it('updates the profile with validation', async () => {
    const u = await registerUser(t.app);
    const res = await request(t.app).patch('/api/v1/auth/me').set(bearer(u)).send({ timezone: 'europe/berlin' }).expect(200);
    expect(res.body.user.timezone).toBe('Europe/Berlin'); // canonicalised
    await request(t.app).patch('/api/v1/auth/me').set(bearer(u)).send({ timezone: 'Mars/Olympus' }).expect(422);
  });
});

describe('refresh token rotation', () => {
  it('requires the CSRF header', async () => {
    const u = await registerUser(t.app);
    await request(t.app).post('/api/v1/auth/refresh').set('Cookie', u.cookie).expect(403);
  });

  it('rotates the refresh token and issues a new access token', async () => {
    const u = await registerUser(t.app);
    const res = await request(t.app).post('/api/v1/auth/refresh').set('Cookie', u.cookie).set(csrf).expect(200);
    const next = refreshCookie(res);
    expect(next).not.toBe(u.cookie);
    expect(res.body.accessToken).toBeTypeOf('string');
    await request(t.app).get('/api/v1/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
  });

  it('tolerates a concurrent refresh within the grace window without rotating again', async () => {
    const u = await registerUser(t.app);
    await request(t.app).post('/api/v1/auth/refresh').set('Cookie', u.cookie).set(csrf).expect(200);
    const again = await request(t.app).post('/api/v1/auth/refresh').set('Cookie', u.cookie).set(csrf).expect(200);
    expect(refreshCookie(again)).toBe('');
  });

  it('revokes the whole family when a rotated token is replayed later (theft detection)', async () => {
    const u = await registerUser(t.app);
    const first = await request(t.app).post('/api/v1/auth/refresh').set('Cookie', u.cookie).set(csrf).expect(200);
    const current = refreshCookie(first);
    // Age the rotation beyond the grace window.
    const oldHash = hashToken(u.cookie.replace('tf_rt=', ''));
    await t.ctx.db.update(sessions).set({ revokedAt: new Date(Date.now() - 60_000) }).where(eq(sessions.tokenHash, oldHash));

    await request(t.app).post('/api/v1/auth/refresh').set('Cookie', u.cookie).set(csrf).expect(401);
    // The legitimate newest token is now dead too.
    await request(t.app).post('/api/v1/auth/refresh').set('Cookie', current).set(csrf).expect(401);
    const audit = await t.ctx.db.query.auditLogs.findMany({ where: eq(auditLogs.userId, u.id) });
    expect(audit.map((a) => a.action)).toContain('auth.refresh_reuse_detected');
  });

  it('a logged-out token is simply invalid (not treated as theft)', async () => {
    const u = await registerUser(t.app);
    await request(t.app).post('/api/v1/auth/logout').set('Cookie', u.cookie).set(csrf).expect(204);
    await request(t.app).post('/api/v1/auth/refresh').set('Cookie', u.cookie).set(csrf).expect(401);
    const audit = await t.ctx.db.query.auditLogs.findMany({ where: eq(auditLogs.userId, u.id) });
    expect(audit.map((a) => a.action)).not.toContain('auth.refresh_reuse_detected');
  });

  it('logout revokes the session', async () => {
    const u = await registerUser(t.app);
    await request(t.app).post('/api/v1/auth/logout').set('Cookie', u.cookie).set(csrf).expect(204);
    await request(t.app).post('/api/v1/auth/refresh').set('Cookie', u.cookie).set(csrf).expect(401);
  });
});

describe('password change & sessions', () => {
  it('changing the password signs out other sessions', async () => {
    const u = await registerUser(t.app);
    const other = await request(t.app).post('/api/v1/auth/login').send({ email: u.email, password: u.password }).expect(200);
    const otherCookie = refreshCookie(other);

    const list = await request(t.app).get('/api/v1/auth/sessions').set(bearer(u)).expect(200);
    expect(list.body.items).toHaveLength(2);
    expect(list.body.items.filter((s: { current: boolean }) => s.current)).toHaveLength(1);

    await request(t.app)
      .post('/api/v1/auth/change-password')
      .set(bearer(u))
      .send({ currentPassword: 'wrong-one-1', newPassword: 'brand-new-pass-2' })
      .expect(422);
    await request(t.app)
      .post('/api/v1/auth/change-password')
      .set(bearer(u))
      .send({ currentPassword: u.password, newPassword: 'brand-new-pass-2' })
      .expect(204);

    await request(t.app).post('/api/v1/auth/refresh').set('Cookie', otherCookie).set(csrf).expect(401);
    await request(t.app).post('/api/v1/auth/refresh').set('Cookie', u.cookie).set(csrf).expect(200);
    await request(t.app).post('/api/v1/auth/login').send({ email: u.email, password: 'brand-new-pass-2' }).expect(200);
  });

  it('can revoke a specific session but not someone else’s', async () => {
    const a = await registerUser(t.app);
    const b = await registerUser(t.app);
    const aSessions = await request(t.app).get('/api/v1/auth/sessions').set(bearer(a)).expect(200);
    await request(t.app).delete(`/api/v1/auth/sessions/${aSessions.body.items[0].id}`).set(bearer(b)).expect(404);
    await request(t.app).delete(`/api/v1/auth/sessions/${aSessions.body.items[0].id}`).set(bearer(a)).expect(204);
  });
});
