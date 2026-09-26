import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApp, registerUser, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());

describe('platform', () => {
  it('exposes liveness, readiness and metrics', async () => {
    await request(t.app).get('/healthz').expect(200, /ok/);
    const ready = await request(t.app).get('/readyz').expect(200);
    expect(ready.body).toMatchObject({ status: 'ready', database: process.env.TEST_DATABASE_URL ? 'postgres' : 'pglite' });
    const metrics = await request(t.app).get('/metrics').expect(200);
    expect(metrics.text).toContain('taskflow_http_request_duration_seconds');
  });

  it('protects metrics when a token is configured', async () => {
    const locked = await createTestApp({ METRICS_TOKEN: 'metrics-token-1234567890' });
    try {
      await request(locked.app).get('/metrics').expect(401);
      await request(locked.app).get('/metrics').set('Authorization', 'Bearer metrics-token-1234567890').expect(200);
    } finally {
      await locked.close();
    }
  });

  it('sets security headers and a request id', async () => {
    const res = await request(t.app).get('/healthz');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-request-id']).toMatch(/.{8,}/);
    const echoed = await request(t.app).get('/healthz').set('X-Request-Id', 'trace-abc-12345');
    expect(echoed.headers['x-request-id']).toBe('trace-abc-12345');
  });

  it('only allows configured CORS origins', async () => {
    const ok = await request(t.app).options('/api/v1/tasks').set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'GET');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const evil = await request(t.app).options('/api/v1/tasks').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'GET');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('returns consistent JSON errors and never leaks internals', async () => {
    // Unknown API routes don't reveal themselves to anonymous callers.
    await request(t.app).get('/api/v1/nope').expect(401);
    const u = await registerUser(t.app);
    const nf = await request(t.app).get('/api/v1/nope').set(bearer(u)).expect(404);
    expect(nf.body.error.code).toBe('NOT_FOUND');
    expect(nf.body.error.requestId).toBeTypeOf('string');
    const bad = await request(t.app).post('/api/v1/tasks').set(bearer(u)).set('Content-Type', 'application/json').send('{"title":').expect(400);
    expect(bad.body.error.message).toBe('Request body is not valid JSON.');
    const big = await request(t.app).post('/api/v1/tasks').set(bearer(u)).send({ title: 'x', description: 'a'.repeat(200_000) }).expect(413);
    expect(big.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('records an audit trail users can read (and only their own)', async () => {
    const u = await registerUser(t.app);
    await request(t.app).post('/api/v1/tasks').set(bearer(u)).send({ title: 'Audited' }).expect(201);
    const res = await request(t.app).get('/api/v1/audit-logs').set(bearer(u)).expect(200);
    const actions = res.body.items.map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['auth.register', 'task.create']));
    expect(res.body.items.every((a: { userId: string }) => a.userId === u.id)).toBe(true);
  });
});
