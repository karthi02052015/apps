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

const api = () => ({
  get: (url: string, user = u) => request(t.app).get(`/api/v1${url}`).set(bearer(user)),
  post: (url: string, body: object, user = u) => request(t.app).post(`/api/v1${url}`).set(bearer(user)).send(body),
  patch: (url: string, body: object, user = u) => request(t.app).patch(`/api/v1${url}`).set(bearer(user)).send(body),
  del: (url: string, user = u) => request(t.app).delete(`/api/v1${url}`).set(bearer(user)),
});

const inDays = (d: number, hours = 12) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + d, hours)).toISOString();
};

describe('task CRUD', () => {
  it('creates a task with tags and subtasks', async () => {
    const res = await api()
      .post('/tasks', { title: '  Write spec  ', priority: 'high', tags: ['Work', 'work', 'docs'], subtasks: ['Outline', 'Draft'] })
      .expect(201);
    expect(res.body.task).toMatchObject({ title: 'Write spec', priority: 'high', status: 'todo', tags: ['docs', 'work'], version: 0 });
    expect(res.body.task.subtasks.map((s: { title: string }) => s.title)).toEqual(['Outline', 'Draft']);
  });

  it('validates input', async () => {
    const res = await api().post('/tasks', { title: '', priority: 'extreme' }).expect(422);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(['title', 'priority']));
    await api().post('/tasks', { title: 'x', recurrence: 'daily' }).expect(422);
    await api().get('/tasks/not-a-uuid').expect(422);
  });

  it('updates fields and bumps the version; rejects stale writes', async () => {
    const { body } = await api().post('/tasks', { title: 'Versioned' }).expect(201);
    const upd = await api().patch(`/tasks/${body.task.id}`, { title: 'Versioned v2', version: 0 }).expect(200);
    expect(upd.body.task).toMatchObject({ title: 'Versioned v2', version: 1 });
    const stale = await api().patch(`/tasks/${body.task.id}`, { title: 'Stale', version: 0 }).expect(409);
    expect(stale.body.error.code).toBe('CONFLICT');
  });

  it('sets and clears completedAt when completing and reopening', async () => {
    const { body } = await api().post('/tasks', { title: 'Finish me' }).expect(201);
    const done = await api().patch(`/tasks/${body.task.id}`, { status: 'done' }).expect(200);
    expect(done.body.task.completedAt).not.toBeNull();
    const reopened = await api().patch(`/tasks/${body.task.id}`, { status: 'todo' }).expect(200);
    expect(reopened.body.task.completedAt).toBeNull();
  });

  it('completing a recurring task spawns the next occurrence', async () => {
    const due = inDays(0, 9);
    const { body } = await api()
      .post('/tasks', { title: 'Standup', dueAt: due, recurrence: 'daily', tags: ['team'], subtasks: ['Yesterday', 'Today'] })
      .expect(201);
    const res = await api().patch(`/tasks/${body.task.id}`, { status: 'done' }).expect(200);
    expect(res.body.task.recurrence).toBeNull();
    const next = res.body.nextOccurrence;
    expect(next).toMatchObject({ title: 'Standup', recurrence: 'daily', status: 'todo', tags: ['team'] });
    expect(new Date(next.dueAt).getTime()).toBeGreaterThan(Date.now());
    expect(next.subtasks.every((s: { done: boolean }) => !s.done)).toBe(true);
  });

  it('soft-deletes, restores and purges', async () => {
    const { body } = await api().post('/tasks', { title: 'Trash me' }).expect(201);
    const id = body.task.id;
    await api().del(`/tasks/${id}?permanent=true`).expect(409); // must be in trash first
    await api().del(`/tasks/${id}`).expect(204);
    const trash = await api().get('/tasks?view=trash').expect(200);
    expect(trash.body.items.map((x: { id: string }) => x.id)).toContain(id);
    await api().patch(`/tasks/${id}`, { title: 'nope' }).expect(409);
    await api().post(`/tasks/${id}/restore`, {}).expect(200);
    await api().del(`/tasks/${id}`).expect(204);
    await api().del(`/tasks/${id}?permanent=true`).expect(204);
    await api().get(`/tasks/${id}`).expect(404);
  });

  it('manages subtasks', async () => {
    const { body } = await api().post('/tasks', { title: 'Parent' }).expect(201);
    const sub = await api().post(`/tasks/${body.task.id}/subtasks`, { title: 'Child' }).expect(201);
    await api().patch(`/tasks/${body.task.id}/subtasks/${sub.body.subtask.id}`, { done: true }).expect(200);
    const task = await api().get(`/tasks/${body.task.id}`).expect(200);
    expect(task.body.task.subtasks[0]).toMatchObject({ title: 'Child', done: true });
    await api().del(`/tasks/${body.task.id}/subtasks/${sub.body.subtask.id}`).expect(204);
  });
});

describe('views, filters, search and pagination', () => {
  let user: TestUser;
  beforeAll(async () => {
    user = await registerUser(t.app);
    const p = await api().post('/projects', { name: 'Filters' }, user).expect(201);
    const make = (b: object) => api().post('/tasks', b, user).expect(201);
    await make({ title: 'Overdue report', dueAt: inDays(-2), allDay: true, priority: 'urgent' });
    await make({ title: 'Due today', dueAt: inDays(0, 23), projectId: p.body.project.id, tags: ['focus'] });
    await make({ title: 'Next week planning', dueAt: inDays(7), priority: 'low' });
    await make({ title: 'Someday learn Rust', description: 'ownership and borrowing' });
    await make({ title: 'Already done', status: 'done' });
  });

  const titles = async (qs: string) =>
    (await api().get(`/tasks?${qs}`, user).expect(200)).body.items.map((x: { title: string }) => x.title) as string[];

  it('today includes overdue and due-today but not future tasks', async () => {
    const today = await titles('view=today');
    expect(today).toEqual(expect.arrayContaining(['Overdue report', 'Due today']));
    expect(today).not.toContain('Next week planning');
  });

  it('overdue, upcoming, inbox and completed views', async () => {
    expect(await titles('view=overdue')).toEqual(['Overdue report']);
    expect(await titles('view=upcoming')).toEqual(['Next week planning']);
    const inbox = await titles('view=inbox');
    expect(inbox).toContain('Someday learn Rust');
    expect(inbox).not.toContain('Due today'); // belongs to a project
    expect(await titles('view=completed')).toContain('Already done');
    expect(await titles('view=all')).not.toContain('Already done');
  });

  it('filters by priority and tag', async () => {
    expect(await titles('priority=urgent,low&sort=priority&order=desc')).toEqual(['Overdue report', 'Next week planning']);
    expect(await titles('tag=focus')).toEqual(['Due today']);
  });

  it('searches titles (partial) and descriptions (full-text)', async () => {
    expect(await titles('q=plann')).toEqual(['Next week planning']);
    expect(await titles('q=borrowing')).toEqual(['Someday learn Rust']);
    expect(await titles('q=%25')).toEqual([]); // wildcard is escaped
  });

  it('paginates with stable keyset cursors and no duplicates', async () => {
    const pager = await registerUser(t.app);
    for (let i = 0; i < 7; i++) await api().post('/tasks', { title: `Page task ${i}`, dueAt: inDays(i % 3) }, pager).expect(201);
    for (const sort of ['position', 'dueAt', 'title', 'createdAt']) {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const qs: string = `sort=${sort}&limit=3${cursor ? `&cursor=${cursor}` : ''}`;
        const res = await api().get(`/tasks?${qs}`, pager).expect(200);
        seen.push(...res.body.items.map((x: { id: string }) => x.id));
        cursor = res.body.nextCursor;
      } while (cursor);
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen.length).toBe(11); // 7 + 4 starter tasks
    }
    await api().get('/tasks?cursor=garbage', pager).expect(422);
  });

  it('uses the caller time zone for day boundaries', async () => {
    const res = await request(t.app).get('/api/v1/tasks/stats').set(bearer(user)).set('X-Timezone', 'Pacific/Kiritimati').expect(200);
    expect(res.body).toHaveProperty('today');
    await request(t.app).get('/api/v1/tasks/stats').set(bearer(user)).set('X-Timezone', 'Not/AZone').expect(200); // falls back to UTC
  });

  it('returns stats including streaks', async () => {
    const res = await api().get('/tasks/stats', user).expect(200);
    expect(res.body).toMatchObject({ overdue: 1, completedToday: 1, streakDays: 1 });
    expect(Object.values(res.body.byProject)).toContain(1);
  });
});

describe('bulk actions', () => {
  it('completes, moves and deletes many tasks at once — only the caller’s', async () => {
    const owner = await registerUser(t.app);
    const intruder = await registerUser(t.app);
    const ids = await Promise.all(
      ['a', 'b', 'c'].map(async (title) => (await api().post('/tasks', { title }, owner).expect(201)).body.task.id as string),
    );
    const foreign = await api().post('/bulk-not-real', {}, owner); // unknown route → JSON 404
    expect(foreign.status).toBe(404);

    const stolen = await api().post('/tasks/bulk', { action: 'complete', ids }, intruder).expect(200);
    expect(stolen.body.updated).toBe(0);

    const done = await api().post('/tasks/bulk', { action: 'complete', ids }, owner).expect(200);
    expect(done.body.updated).toBe(3);
    const del = await api().post('/tasks/bulk', { action: 'delete', ids: [ids[0]] }, owner).expect(200);
    expect(del.body.updated).toBe(1);
    await api().post('/tasks/bulk', { action: 'explode', ids }, owner).expect(422);
  });
});

describe('authorization boundaries', () => {
  it('never exposes or mutates another user’s tasks', async () => {
    const alice = await registerUser(t.app);
    const mallory = await registerUser(t.app);
    const { body } = await api().post('/tasks', { title: 'Alice secret' }, alice).expect(201);
    const id = body.task.id;

    await api().get(`/tasks/${id}`, mallory).expect(404);
    await api().patch(`/tasks/${id}`, { title: 'pwned' }, mallory).expect(404);
    await api().del(`/tasks/${id}`, mallory).expect(404);
    await api().post(`/tasks/${id}/subtasks`, { title: 'x' }, mallory).expect(404);
    const list = await api().get('/tasks?q=Alice', mallory).expect(200);
    expect(list.body.items).toHaveLength(0);

    // Cannot attach tasks to someone else's project either.
    const proj = await api().post('/projects', { name: 'Alice only' }, alice).expect(201);
    await api().post('/tasks', { title: 'sneaky', projectId: proj.body.project.id }, mallory).expect(422);
  });
});

describe('hardening', () => {
  it('rejects forged cursors with 422 instead of a server error', async () => {
    const forged = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
    await api().get(`/tasks?sort=dueAt&cursor=${forged({ v: 'not-a-date', id: '00000000-0000-4000-8000-000000000000' })}`).expect(422);
    await api().get(`/tasks?sort=priority&cursor=${forged({ v: '1; drop table', id: '00000000-0000-4000-8000-000000000000' })}`).expect(422);
    await api().get(`/notifications?cursor=${forged({ t: 'x', id: 'y' })}`).expect(422);
  });

  it('rejects malformed tag names in task payloads', async () => {
    await api().post('/tasks', { title: 'x', tags: ['has space'] }).expect(422);
    await api().post('/tasks', { title: 'x', tags: ['<script>'] }).expect(422);
  });

  it('completing an all-day recurring task that was due earlier keeps today’s occurrence', async () => {
    const start = new Date();
    const lastWeek = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() - 7)).toISOString();
    const todayUtc = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())).toISOString();
    const { body } = await api().post('/tasks', { title: 'Weekly review', dueAt: lastWeek, allDay: true, recurrence: 'weekly' }).expect(201);
    const res = await api().patch(`/tasks/${body.task.id}`, { status: 'done' }).expect(200);
    expect(res.body.nextOccurrence.dueAt).toBe(todayUtc);
  });
});
