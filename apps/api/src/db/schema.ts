/**
 * TaskFlow database schema (PostgreSQL dialect).
 *
 * The same schema and migrations run on real PostgreSQL in production and on
 * embedded PGlite (Postgres compiled to WASM) for zero-setup local dev/tests,
 * so there is exactly one source of truth and no dialect drift.
 */
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { NOTIFICATION_TYPES, RECURRENCE_RULES, TASK_STATUSES, USER_ROLES } from '@taskflow/shared';

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });
const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => timestamptz('created_at').notNull().defaultNow();
const updatedAt = () =>
  timestamptz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const userRole = pgEnum('user_role', USER_ROLES);
export const taskStatus = pgEnum('task_status', TASK_STATUSES);
export const recurrenceRule = pgEnum('recurrence_rule', RECURRENCE_RULES);
export const notificationType = pgEnum('notification_type', NOTIFICATION_TYPES);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 254 }).notNull(),
    name: varchar('name', { length: 80 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    role: userRole('role').notNull().default('user'),
    timezone: varchar('timezone', { length: 64 }).notNull().default('UTC'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamptz('locked_until'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_email_key').on(sql`lower(${t.email})`)],
);

/**
 * Refresh-token sessions. Only SHA-256 hashes are stored. Tokens rotate on
 * every use; `familyId` links a rotation chain so replay of a stolen token
 * revokes the entire family.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    familyId: uuid('family_id').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    revokedAt: timestamptz('revoked_at'),
    /** Set when revoked by rotation (vs. logout) — enables a short race grace window. */
    replacedById: uuid('replaced_by_id'),
    userAgent: varchar('user_agent', { length: 400 }),
    ip: varchar('ip', { length: 64 }),
    createdAt: createdAt(),
    lastUsedAt: timestamptz('last_used_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_key').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId, t.revokedAt),
    index('sessions_family_idx').on(t.familyId),
    index('sessions_expires_idx').on(t.expiresAt),
  ],
);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 80 }).notNull(),
    color: varchar('color', { length: 7 }).notNull().default('#6366f1'),
    icon: varchar('icon', { length: 32 }),
    position: doublePrecision('position').notNull().default(0),
    archivedAt: timestamptz('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('projects_user_name_key').on(t.userId, sql`lower(${t.name})`),
    index('projects_user_idx').on(t.userId, t.archivedAt, t.position),
  ],
);

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 40 }).notNull(),
    color: varchar('color', { length: 7 }).notNull().default('#64748b'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('tags_user_name_key').on(t.userId, t.name)],
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    title: varchar('title', { length: 500 }).notNull(),
    description: text('description'),
    status: taskStatus('status').notNull().default('todo'),
    /** 0 none … 4 urgent — numeric so it sorts naturally. */
    priority: smallint('priority').notNull().default(0),
    dueAt: timestamptz('due_at'),
    allDay: boolean('all_day').notNull().default(false),
    remindAt: timestamptz('remind_at'),
    reminderSentAt: timestamptz('reminder_sent_at'),
    overdueNotifiedAt: timestamptz('overdue_notified_at'),
    recurrence: recurrenceRule('recurrence'),
    position: doublePrecision('position').notNull().default(0),
    completedAt: timestamptz('completed_at'),
    deletedAt: timestamptz('deleted_at'),
    version: integer('version').notNull().default(0),
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`setweight(to_tsvector('simple', coalesce(title, '')), 'A') || setweight(to_tsvector('simple', coalesce(description, '')), 'B')`,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('tasks_priority_range', sql`${t.priority} between 0 and 4`),
    check('tasks_completed_consistency', sql`(${t.status} = 'done') = (${t.completedAt} is not null)`),
    index('tasks_user_view_idx').on(t.userId, t.deletedAt, t.status, t.dueAt),
    index('tasks_user_project_idx').on(t.userId, t.projectId, t.position),
    index('tasks_user_completed_idx').on(t.userId, t.completedAt),
    index('tasks_reminder_idx')
      .on(t.remindAt)
      .where(sql`${t.reminderSentAt} is null and ${t.deletedAt} is null and ${t.status} <> 'done'`),
    index('tasks_overdue_idx')
      .on(t.dueAt)
      .where(sql`${t.overdueNotifiedAt} is null and ${t.deletedAt} is null and ${t.status} <> 'done'`),
    index('tasks_search_idx').using('gin', t.searchVector),
  ],
);

export const taskTags = pgTable(
  'task_tags',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.tagId] }), index('task_tags_tag_idx').on(t.tagId)],
);

export const subtasks = pgTable(
  'subtasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 500 }).notNull(),
    done: boolean('done').notNull().default(false),
    position: doublePrecision('position').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('subtasks_task_idx').on(t.taskId, t.position)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    type: notificationType('type').notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    body: varchar('body', { length: 1000 }),
    readAt: timestamptz('read_at'),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.readAt, t.createdAt)],
);

/** Append-only security and activity trail. */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 64 }).notNull(),
    entityType: varchar('entity_type', { length: 32 }),
    entityId: varchar('entity_id', { length: 64 }),
    ip: varchar('ip', { length: 64 }),
    userAgent: varchar('user_agent', { length: 400 }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index('audit_user_idx').on(t.userId, t.createdAt), index('audit_action_idx').on(t.action, t.createdAt)],
);

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  projects: many(projects),
  tasks: many(tasks),
}));
export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
  subtasks: many(subtasks),
  taskTags: many(taskTags),
}));

export type User = typeof users.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type Subtask = typeof subtasks.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
