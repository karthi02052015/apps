import type { TaskView } from '@taskflow/shared';

export interface TaskListParams {
  view: TaskView;
  projectId?: string;
  tag?: string;
  q?: string;
  priority?: string[];
  status?: string[];
  sort?: string;
  order?: 'asc' | 'desc';
  includeCompleted?: boolean;
}

/** Central query-key factory — one place to reason about cache invalidation. */
export const keys = {
  me: ['me'] as const,
  tasks: {
    all: ['tasks'] as const,
    list: (p: TaskListParams) => ['tasks', 'list', p] as const,
    detail: (id: string) => ['tasks', 'detail', id] as const,
  },
  stats: ['stats'] as const,
  projects: ['projects'] as const,
  tags: ['tags'] as const,
  notifications: ['notifications'] as const,
  sessions: ['sessions'] as const,
  audit: ['audit'] as const,
};
