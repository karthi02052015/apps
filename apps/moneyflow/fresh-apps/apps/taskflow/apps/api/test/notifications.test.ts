import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApp, registerUser, type TestApp, type TestUser } from './helpers';

let t: TestApp;
let u: TestUser;
beforeAll(async () => {
  t = await createTestApp();
  u = await registerUser(t.app);
});
afterAll(async () => t.close());

describe('scheduler', () => {
  it('sends a reminder exactly once, then re-arms when the reminder moves', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const { body } = await request(t.app).post('/api/v1/tasks').set(bearer(u)).send({ title: 'Call the bank', remindAt: past }).expect(201);

    expect((await t.scheduler.tick()).reminders).toBe(1);
    expect((await t.scheduler.tick()).reminders).toBe(0); // idempotent

    const list = await request(t.app).get('/api/v1/notifications').set(bearer(u)).expect(200);
    expect(list.body.unreadCount).toBe(1);
    expect(list.body.items[0]).toMatchObject({ type: 'reminder', body: 'Call the bank', taskId: body.task.id });

    await request(t.app).patch(`/api/v1/tasks/${body.task.id}`).set(bearer(u)).send({ remindAt: past }).expect(200);
    expect((await t.scheduler.tick()).reminders).toBe(1);
  });

  it('does not remind about completed or deleted tasks', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    await request(t.app).post('/api/v1/tasks').set(bearer(u)).send({ title: 'Done already', remindAt: past, status: 'done' }).expect(201);
    const del = await request(t.app).post('/api/v1/tasks').set(bearer(u)).send({ title: 'Deleted', remindAt: past }).expect(201);
    await request(t.app).delete(`/api/v1/tasks/${del.body.task.id}`).set(bearer(u)).expect(204);
    expect((await t.scheduler.tick()).reminders).toBe(0);
  });

  it('notifies once when a timed task becomes overdue', async () => {
    const past = new Date(Date.now() - 5 * 60_000).toISOString();
    await request(t.app).post('/api/v1/tasks').set(bearer(u)).send({ title: 'Submit invoice', dueAt: past }).expect(201);
    expect((await t.scheduler.tick()).overdue).toBeGreaterThanOrEqual(1);
    expect((await t.scheduler.tick()).overdue).toBe(0);
  });

  it('marks notifications read (individually or all)', async () => {
    const list = await request(t.app).get('/api/v1/notifications?unread=true').set(bearer(u)).expect(200);
    const first = list.body.items[0].id;
    const one = await request(t.app).post('/api/v1/notifications/read').set(bearer(u)).send({ ids: [first] }).expect(200);
    expect(one.body.updated).toBe(1);
    await request(t.app).post('/api/v1/notifications/read').set(bearer(u)).send({ all: true }).expect(200);
    const after = await request(t.app).get('/api/v1/notifications').set(bearer(u)).expect(200);
    expect(after.body.unreadCount).toBe(0);
    await request(t.app).post('/api/v1/notifications/read').set(bearer(u)).send({}).expect(422);
  });
});

describe('realtime stream', () => {
  it('rejects unauthenticated connections', async () => {
    await request(t.app).get('/api/v1/events').expect(401);
  });

  it('pushes task changes to connected clients over SSE', async () => {
    const server = t.app.listen(0);
    const { port } = server.address() as AddressInfo;
    const controller = new AbortController();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/events`, {
        headers: { Authorization: `Bearer ${u.token}` },
        signal: controller.signal,
      });
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const waitFor = async (needle: string) => {
        const deadline = Date.now() + 5_000;
        while (!buffer.includes(needle) && Date.now() < deadline) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
        }
        return buffer.includes(needle);
      };
      expect(await waitFor('event: ping')).toBe(true);
      await request(t.app).post('/api/v1/tasks').set(bearer(u)).send({ title: 'Live!' }).expect(201);
      expect(await waitFor('event: tasks.changed')).toBe(true);

      // Signing out everywhere closes open streams immediately.
      await request(t.app).post('/api/v1/auth/logout-all').set(bearer(u)).expect(204);
      const { done } = await Promise.race([
        (async () => {
          for (;;) {
            const r = await reader.read();
            if (r.done) return r;
          }
        })(),
        new Promise<{ done: false }>((r) => setTimeout(() => r({ done: false }), 3_000)),
      ]);
      expect(done).toBe(true);
      // …and a revoked session can't open a new one.
      const again = await fetch(`http://127.0.0.1:${port}/api/v1/events`, { headers: { Authorization: `Bearer ${u.token}` } });
      expect(again.status).toBe(401);
    } finally {
      controller.abort();
      server.close();
    }
  });
});
