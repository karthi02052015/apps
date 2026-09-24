import { z } from 'zod';
import {
  LIMITS,
  RECURRENCE_RULES,
  TASK_PRIORITIES,
  TASK_SORT_FIELDS,
  TASK_STATUSES,
  TASK_VIEWS,
  type RecurrenceRule,
  type TaskPriority,
  type TaskStatus,
} from '../constants';
import { csvArray, idSchema, isoDateTimeSchema, paginationQuerySchema, tagNameSchema } from './common';

export const taskStatusSchema = z.enum(TASK_STATUSES);
export const taskPrioritySchema = z.enum(TASK_PRIORITIES);
export const recurrenceSchema = z.enum(RECURRENCE_RULES);

const titleSchema = z.string().trim().min(1, 'Title is required').max(LIMITS.titleMax);
const descriptionSchema = z.string().max(LIMITS.descriptionMax);
const tagNamesSchema = z
  .array(tagNameSchema)
  .max(LIMITS.tagsPerTask)
  .transform((tags) => Array.from(new Set(tags)));

export const createTaskSchema = z
  .object({
    title: titleSchema,
    description: descriptionSchema.nullish(),
    status: taskStatusSchema.default('todo'),
    priority: taskPrioritySchema.default('none'),
    projectId: idSchema.nullish(),
    dueAt: isoDateTimeSchema.nullish(),
    allDay: z.boolean().default(false),
    remindAt: isoDateTimeSchema.nullish(),
    recurrence: recurrenceSchema.nullish(),
    tags: tagNamesSchema.optional(),
    subtasks: z.array(z.string().trim().min(1).max(LIMITS.titleMax)).max(LIMITS.subtasksPerTask).optional(),
  })
  .refine((t) => !t.recurrence || t.dueAt, { message: 'Recurring tasks need a due date', path: ['recurrence'] });
export type CreateTaskInput = z.input<typeof createTaskSchema>;

export const updateTaskSchema = z
  .object({
    title: titleSchema.optional(),
    description: descriptionSchema.nullish(),
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    projectId: idSchema.nullish(),
    dueAt: isoDateTimeSchema.nullish(),
    allDay: z.boolean().optional(),
    remindAt: isoDateTimeSchema.nullish(),
    recurrence: recurrenceSchema.nullish(),
    tags: tagNamesSchema.optional(),
    position: z.number().finite().optional(),
    /** Optimistic concurrency: when supplied, the update fails with 409 if the task changed since. */
    version: z.number().int().nonnegative().optional(),
  })
  .refine((v) => Object.keys(v).some((k) => k !== 'version'), 'Nothing to update');
export type UpdateTaskInput = z.input<typeof updateTaskSchema>;

export const listTasksQuerySchema = paginationQuerySchema.extend({
  view: z.enum(TASK_VIEWS).default('all'),
  status: csvArray(taskStatusSchema),
  priority: csvArray(taskPrioritySchema),
  projectId: idSchema.optional(),
  tag: z.string().trim().min(1).max(40).optional(),
  q: z.string().trim().max(LIMITS.searchMax).optional(),
  dueFrom: isoDateTimeSchema.optional(),
  dueTo: isoDateTimeSchema.optional(),
  sort: z.enum(TASK_SORT_FIELDS).default('position'),
  order: z.enum(['asc', 'desc']).default('asc'),
  includeCompleted: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

export const bulkTaskSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('complete'), ids: z.array(idSchema).min(1).max(LIMITS.bulkMax) }),
  z.object({ action: z.literal('reopen'), ids: z.array(idSchema).min(1).max(LIMITS.bulkMax) }),
  z.object({ action: z.literal('delete'), ids: z.array(idSchema).min(1).max(LIMITS.bulkMax) }),
  z.object({
    action: z.literal('move'),
    ids: z.array(idSchema).min(1).max(LIMITS.bulkMax),
    projectId: idSchema.nullable(),
  }),
  z.object({
    action: z.literal('priority'),
    ids: z.array(idSchema).min(1).max(LIMITS.bulkMax),
    priority: taskPrioritySchema,
  }),
]);
export type BulkTaskInput = z.infer<typeof bulkTaskSchema>;

export const createSubtaskSchema = z.object({ title: titleSchema });
export const updateSubtaskSchema = z
  .object({ title: titleSchema.optional(), done: z.boolean().optional(), position: z.number().finite().optional() })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export interface SubtaskDTO {
  id: string;
  title: string;
  done: boolean;
  position: number;
}

export interface TaskDTO {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  projectId: string | null;
  dueAt: string | null;
  allDay: boolean;
  remindAt: string | null;
  recurrence: RecurrenceRule | null;
  position: number;
  completedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  tags: string[];
  subtasks: SubtaskDTO[];
}

export interface TaskMutationResult {
  task: TaskDTO;
  /** Present when completing a recurring task spawned its next occurrence. */
  nextOccurrence?: TaskDTO;
}

export interface TaskStatsDTO {
  inbox: number;
  today: number;
  upcoming: number;
  overdue: number;
  completedToday: number;
  completedThisWeek: number;
  /** Consecutive days (ending today or yesterday) with at least one completed task. */
  streakDays: number;
  byProject: Record<string, number>;
}
