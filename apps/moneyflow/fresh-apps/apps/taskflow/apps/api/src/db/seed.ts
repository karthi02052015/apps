/* eslint-disable no-console -- CLI script */
/**
 * Development seed: creates a demo account with realistic data.
 *   npm run db:seed   →  demo@taskflow.dev / taskflow-demo-1
 * Idempotent — does nothing if the demo user already exists. Refuses to run in production.
 */
import { eq, sql } from 'drizzle-orm';
import { createContext, disposeContext } from '../bootstrap';
import { loadEnv } from '../config/env';
import { createLogger } from '../lib/logger';
import { AuthService } from '../modules/auth/auth.service';
import { ProjectsService } from '../modules/projects/projects.service';
import { TasksService } from '../modules/tasks/tasks.service';
import { users } from './schema';
import { createTaskSchema, startOfZonedDay } from '@taskflow/shared';

const DEMO = { email: 'demo@taskflow.dev', password: 'taskflow-demo-1', name: 'Demo User' };

const env = loadEnv();
if (env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data in production.');
  process.exit(1);
}
const logger = createLogger(env);
const ctx = await createContext({ ...env, AUTO_MIGRATE: true }, logger);
const meta = { ip: '127.0.0.1', userAgent: 'seed' };

try {
  const existing = await ctx.db.query.users.findFirst({ where: sql`lower(${users.email}) = ${DEMO.email}` });
  if (existing) {
    console.log(`Demo user already exists → ${DEMO.email} / ${DEMO.password}`);
  } else {
    const tz = 'UTC';
    const { user } = await new AuthService(ctx).register({ ...DEMO, timezone: tz }, meta);
    await ctx.db.update(users).set({ role: 'admin' }).where(eq(users.id, user.id));
    const projects = new ProjectsService(ctx);
    const tasks = new TasksService(ctx);
    const work = await projects.create(user.id, { name: 'Work', color: '#0ea5e9', icon: 'briefcase' }, meta);
    const home = await projects.create(user.id, { name: 'Home', color: '#22c55e', icon: 'home' }, meta);
    const today = startOfZonedDay(new Date(), tz);
    const at = (days: number, hours = 0) => new Date(today.getTime() + days * 86_400_000 + hours * 3_600_000).toISOString();

    const samples = [
      { title: 'Prepare Q4 roadmap review', projectId: work.id, priority: 'high', dueAt: at(0, 15), tags: ['planning'], subtasks: ['Collect metrics', 'Draft slides', 'Share pre-read'] },
      { title: 'Reply to design feedback', projectId: work.id, priority: 'medium', dueAt: at(-1), allDay: true, tags: ['design'] },
      { title: 'Fix flaky login test', projectId: work.id, priority: 'urgent', status: 'in_progress', dueAt: at(1, 11), tags: ['engineering'] },
      { title: 'Weekly 1:1 notes', projectId: work.id, dueAt: at(2, 10), recurrence: 'weekly', tags: ['meetings'] },
      { title: 'Book dentist appointment', projectId: home.id, priority: 'low', dueAt: at(3), allDay: true },
      { title: 'Water the plants', projectId: home.id, dueAt: at(0), allDay: true, recurrence: 'daily' },
      { title: 'Plan weekend hike', projectId: home.id, dueAt: at(4), allDay: true, tags: ['outdoors'] },
      { title: 'Read "Deep Work" chapter 3', priority: 'none' },
      { title: 'Renew passport', priority: 'medium', dueAt: at(12), allDay: true },
    ];
    for (const s of samples) await tasks.create(user.id, createTaskSchema.parse(s), meta);
    const done = await tasks.create(user.id, createTaskSchema.parse({ title: 'Set up TaskFlow', status: 'done' }), meta);
    logger.info({ id: done.id }, 'seeded');
    console.log(`Seeded demo account → ${DEMO.email} / ${DEMO.password}`);
  }
} finally {
  await disposeContext(ctx);
}
