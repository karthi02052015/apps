/**
 * Domain constants shared by API and web. Keep this file free of runtime
 * dependencies so it can be imported anywhere (browser, Node, tests).
 */

export const TASK_STATUSES = ['todo', 'in_progress', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
};

/** Ordered from lowest to highest so the index doubles as a sortable rank. */
export const TASK_PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  none: 'No priority',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export const priorityToRank = (p: TaskPriority): number => TASK_PRIORITIES.indexOf(p);
export const rankToPriority = (rank: number): TaskPriority =>
  TASK_PRIORITIES[Math.min(Math.max(Math.trunc(rank), 0), TASK_PRIORITIES.length - 1)] ?? 'none';

export const RECURRENCE_RULES = ['daily', 'weekdays', 'weekly', 'monthly', 'yearly'] as const;
export type RecurrenceRule = (typeof RECURRENCE_RULES)[number];

export const RECURRENCE_LABELS: Record<RecurrenceRule, string> = {
  daily: 'Every day',
  weekdays: 'Every weekday',
  weekly: 'Every week',
  monthly: 'Every month',
  yearly: 'Every year',
};

export const TASK_VIEWS = ['inbox', 'today', 'upcoming', 'overdue', 'completed', 'all', 'trash'] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

export const TASK_SORT_FIELDS = ['position', 'dueAt', 'priority', 'createdAt', 'updatedAt', 'title'] as const;
export type TaskSortField = (typeof TASK_SORT_FIELDS)[number];

export const NOTIFICATION_TYPES = ['reminder', 'overdue', 'system'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const USER_ROLES = ['user', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Curated palette — every colour passes WCAG AA as a dot/label on both themes. */
export const PROJECT_COLORS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // amber
  '#22c55e', // green
  '#14b8a6', // teal
  '#0ea5e9', // sky
  '#64748b', // slate
] as const;

export const LIMITS = {
  titleMax: 500,
  descriptionMax: 20_000,
  nameMax: 80,
  tagsPerTask: 20,
  subtasksPerTask: 100,
  pageSizeDefault: 50,
  pageSizeMax: 200,
  bulkMax: 200,
  searchMax: 200,
  passwordMin: 10,
  passwordMax: 128,
} as const;

export const API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'ACCOUNT_LOCKED',
  'PAYLOAD_TOO_LARGE',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
