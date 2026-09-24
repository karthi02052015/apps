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

describe('projects', () => {
  it('creates, renames, archives and lists projects', async () => {
    const created = await request(t.app).post('/api/v1/projects').set(bearer(u)).send({ name: 'Launch', color: '#ec4899' }).expect(201);
    const id = created.body.project.id;
    await request(t.app).patch(`/api/v1/projects/${id}`).set(bearer(u)).send({ name: 'Launch 2.0' }).expect(200);
    await request(t.app).patch(`/api/v1/projects/${id}`).set(bearer(u)).send({ archived: true }).expect(200);
    const active = await request(t.app).get('/api/v1/projects').set(bearer(u)).expect(200);
    expect(active.body.items.map((p: { name: string }) => p.name)).not.toContain('Launch 2.0');
    const all = await request(t.app).get('/api/v1/projects?includeArchived=true').set(bearer(u)).expect(200);
    expect(all.body.items.map((p: { name: string }) => p.name)).toContain('Launch 2.0');
  });

  it('enforces unique names per user, case-insensitively', async () => {
    await request(t.app).post('/api/v1/projects').set(bearer(u)).send({ name: 'Errands' }).expect(201);
    await request(t.app).post('/api/v1/projects').set(bearer(u)).send({ name: 'errands' }).expect(409);
    const other = await registerUser(t.app);
    await request(t.app).post('/api/v1/projects').set(bearer(other)).send({ name: 'Errands' }).expect(201);
  });

  it('rejects invalid colours', async () => {
    await request(t.app).post('/api/v1/projects').set(bearer(u)).send({ name: 'Bad', color: 'red' }).expect(422);
  });

  it('deleting a project moves its tasks to the inbox', async () => {
    const p = await request(t.app).post('/api/v1/projects').set(bearer(u)).send({ name: 'Temp' }).expect(201);
    const task = await request(t.app)
      .post('/api/v1/tasks')
      .set(bearer(u))
      .send({ title: 'Survivor', projectId: p.body.project.id })
      .expect(201);
    await request(t.app).delete(`/api/v1/projects/${p.body.project.id}`).set(bearer(u)).expect(204);
    const after = await request(t.app).get(`/api/v1/tasks/${task.body.task.id}`).set(bearer(u)).expect(200);
    expect(after.body.task.projectId).toBeNull();
  });
});

describe('tags', () => {
  it('lists tags with open task counts and supports rename/delete', async () => {
    await request(t.app).post('/api/v1/tasks').set(bearer(u)).send({ title: 'Tagged', tags: ['deep-work'] }).expect(201);
    const list = await request(t.app).get('/api/v1/tags').set(bearer(u)).expect(200);
    const tag = list.body.items.find((x: { name: string }) => x.name === 'deep-work');
    expect(tag.taskCount).toBe(1);
    await request(t.app).post('/api/v1/tags').set(bearer(u)).send({ name: 'Deep-Work' }).expect(409);
    await request(t.app).post('/api/v1/tags').set(bearer(u)).send({ name: 'has space' }).expect(422);
    await request(t.app).patch(`/api/v1/tags/${tag.id}`).set(bearer(u)).send({ color: '#22c55e' }).expect(200);
    await request(t.app).delete(`/api/v1/tags/${tag.id}`).set(bearer(u)).expect(204);
  });
});
