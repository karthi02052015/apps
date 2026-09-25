import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app';
import { createContext, disposeContext } from '../src/bootstrap';
import { loadEnv } from '../src/config/env';
import type { AppContext } from '../src/context';
import { createLogger } from '../src/lib/logger';
import { Scheduler } from '../src/modules/notifications/scheduler';

export interface TestApp {
  app: Express;
  ctx: AppContext;
  scheduler: Scheduler;
  close(): Promise<void>;
}

/**
 * Each test file gets an isolated database: in-memory PGlite by default, or a
 * throwaway database on a real PostgreSQL server when TEST_DATABASE_URL is set
 * (used in CI to verify production parity).
 */
async function provisionDatabase(): Promise<{ url?: string; drop: () => Promise<void> }> {
  const admin = process.env.TEST_DATABASE_URL;
  if (!admin) return { drop: async () => undefined };
  const { default: pg } = await import('pg');
  const name = `taskflow_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const client = new pg.Client({ connectionString: admin });
  await client.connect();
  await client.query(`CREATE DATABASE ${name}`);
  await client.end();
  const url = new URL(admin);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    drop: async () => {
      const c = new pg.Client({ connectionString: admin });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c.end();
    },
  };
}

export async function createTestApp(overrides: Record<string, string> = {}): Promise<TestApp> {
  const database = await provisionDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    PGLITE_DATA_DIR: 'memory://',
    ...(database.url ? { DATABASE_URL: database.url } : {}),
    JWT_SECRET: 'test-secret-that-is-definitely-long-enough-123',
    CORS_ORIGINS: 'http://localhost:5173',
    ...overrides,
  });
  const ctx = await createContext(env, createLogger(env));
  return {
    app: createApp(ctx),
    ctx,
    scheduler: new Scheduler(ctx),
    close: async () => {
      await disposeContext(ctx);
      await database.drop();
    },
  };
}

let counter = 0;
export interface TestUser {
  id: string;
  email: string;
  password: string;
  token: string;
  cookie: string;
}

export async function registerUser(app: Express, overrides: { email?: string; timezone?: string } = {}): Promise<TestUser> {
  counter += 1;
  const email = overrides.email ?? `user${counter}-${Date.now()}@example.com`;
  const password = 'correct-horse-9';
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({ name: `User ${counter}`, email, password, timezone: overrides.timezone ?? 'UTC' })
    .expect(201);
  return { id: res.body.user.id, email, password, token: res.body.accessToken, cookie: refreshCookie(res) };
}

export function refreshCookie(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const c = raw?.find((x) => x.startsWith('tf_rt='));
  return c ? c.split(';')[0]! : '';
}

export const bearer = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });
