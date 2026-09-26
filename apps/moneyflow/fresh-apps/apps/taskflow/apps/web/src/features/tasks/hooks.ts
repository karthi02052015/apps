import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import type {
  BulkTaskInput,
  CreateTaskInput,
  Page,
  SubtaskDTO,
  TaskDTO,
  TaskMutationResult,
  TaskStatsDTO,
  UpdateTaskInput,
} from '@taskflow/shared';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { keys, type TaskListParams } from '../../lib/keys';

type TaskPages = InfiniteData<Page<TaskDTO>, string | null>;

export function useTaskList(params: TaskListParams) {
  return useInfiniteQuery({
    queryKey: keys.tasks.list(params),
    queryFn: ({ pageParam, signal }) =>
      api<Page<TaskDTO>>('/tasks', { query: { ...params, cursor: pageParam ?? undefined, limit: 100 }, signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useTask(id: string | null) {
  const qc = useQueryClient();
  return useQuery<TaskDTO>({
    queryKey: keys.tasks.detail(id ?? 'none'),
    queryFn: ({ signal }) => api<{ task: TaskDTO }>(`/tasks/${id}`, { signal }).then((r) => r.task),
    enabled: !!id,
    // Paint instantly from any list that already has this task.
    placeholderData: () => (id ? findInLists(qc, id) : undefined),
  });
}

export function useStats() {
  return useQuery({
    queryKey: keys.stats,
    queryFn: ({ signal }) => api<TaskStatsDTO>('/tasks/stats', { signal }),
    staleTime: 15_000,
  });
}

// ------------------------------------------------------------- cache utils

function findInLists(qc: QueryClient, id: string): TaskDTO | undefined {
  for (const [, data] of qc.getQueriesData<TaskPages>({ queryKey: ['tasks', 'list'] })) {
    for (const page of data?.pages ?? []) {
      const hit = page.items.find((t) => t.id === id);
      if (hit) return hit;
    }
  }
  return undefined;
}

function patchTaskEverywhere(qc: QueryClient, id: string, patch: (t: TaskDTO) => TaskDTO) {
  qc.setQueriesData<TaskPages>({ queryKey: ['tasks', 'list'] }, (data) =>
    data
      ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((t) => (t.id === id ? patch(t) : t)) })) }
      : data,
  );
  qc.setQueryData<TaskDTO>(keys.tasks.detail(id), (t) => (t ? patch(t) : t));
}

function removeTaskEverywhere(qc: QueryClient, id: string) {
  qc.setQueriesData<TaskPages>({ queryKey: ['tasks', 'list'] }, (data) =>
    data ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.filter((t) => t.id !== id) })) } : data,
  );
}

async function snapshot(qc: QueryClient) {
  await qc.cancelQueries({ queryKey: keys.tasks.all });
  return qc.getQueriesData({ queryKey: keys.tasks.all });
}
function restore(qc: QueryClient, snap: Awaited<ReturnType<typeof snapshot>> | undefined) {
  snap?.forEach(([key, data]) => qc.setQueryData(key, data));
}
const invalidate = (qc: QueryClient) => {
  void qc.invalidateQueries({ queryKey: keys.tasks.all });
  void qc.invalidateQueries({ queryKey: keys.stats });
  void qc.invalidateQueries({ queryKey: keys.projects });
  void qc.invalidateQueries({ queryKey: keys.tags });
};

/** Apply a DTO-level patch optimistically (mirrors what the server will do). */
function applyPatch(t: TaskDTO, input: UpdateTaskInput): TaskDTO {
  const next: TaskDTO = { ...t, updatedAt: new Date().toISOString() };
  for (const [k, v] of Object.entries(input)) {
    if (k === 'version' || v === undefined) continue;
    (next as unknown as Record<string, unknown>)[k] = v;
  }
  if (input.status === 'done' && t.status !== 'done') next.completedAt = new Date().toISOString();
  if (input.status && input.status !== 'done') next.completedAt = null;
  return next;
}

// --------------------------------------------------------------- mutations

export function useCreateTask(listKey?: readonly unknown[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTaskInput) => api<{ task: TaskDTO }>('/tasks', { method: 'POST', body: input }).then((r) => r.task),
    onMutate: async (input) => {
      if (!listKey) return;
      const snap = await snapshot(qc);
      const now = new Date().toISOString();
      const temp: TaskDTO = {
        id: `temp-${crypto.randomUUID()}`,
        title: input.title,
        description: input.description ?? null,
        status: input.status ?? 'todo',
        priority: input.priority ?? 'none',
        projectId: input.projectId ?? null,
        dueAt: input.dueAt ?? null,
        allDay: input.allDay ?? false,
        remindAt: input.remindAt ?? null,
        recurrence: input.recurrence ?? null,
        position: Number.MAX_SAFE_INTEGER,
        completedAt: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
        version: 0,
        tags: input.tags ?? [],
        subtasks: [],
      };
      qc.setQueryData<TaskPages>(listKey, (data) => {
        if (!data?.pages.length) return data;
        const pages = [...data.pages];
        const last = pages.length - 1;
        pages[last] = { ...pages[last]!, items: [...pages[last]!.items, temp] };
        return { ...data, pages };
      });
      return { snap };
    },
    onError: (_e, _v, ctx) => restore(qc, ctx?.snap),
    onSettled: () => invalidate(qc),
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTaskInput }) =>
      api<TaskMutationResult>(`/tasks/${id}`, { method: 'PATCH', body: input }),
    onMutate: async ({ id, input }) => {
      const snap = await snapshot(qc);
      patchTaskEverywhere(qc, id, (t) => applyPatch(t, input));
      return { snap };
    },
    onError: (_e, _v, ctx) => restore(qc, ctx?.snap),
    onSuccess: (res) => {
      patchTaskEverywhere(qc, res.task.id, () => res.task);
      if (res.nextOccurrence) toast.success('Nice! Next occurrence scheduled.', { description: res.nextOccurrence.title });
    },
    onSettled: () => invalidate(qc),
  });
}

/** Toggle completion with an undo affordance — the most frequent action in the app. */
export function useToggleComplete() {
  const update = useUpdateTask();
  const qc = useQueryClient();
  return (task: TaskDTO) => {
    const done = task.status !== 'done';
    update.mutate(
      { id: task.id, input: { status: done ? 'done' : 'todo' } },
      {
        onSuccess: (res) => {
          if (!done) return;
          const undo = async () => {
            // For recurring tasks, undo must also retract the spawned occurrence and move the rule back.
            if (res.nextOccurrence) {
              await api(`/tasks/${res.nextOccurrence.id}`, { method: 'DELETE' });
              await api(`/tasks/${res.nextOccurrence.id}`, { method: 'DELETE', query: { permanent: 'true' } });
            }
            update.mutate({
              id: task.id,
              input: { status: 'todo', ...(res.nextOccurrence ? { recurrence: res.nextOccurrence.recurrence } : {}) },
            });
          };
          toast('Task completed', {
            description: task.title,
            action: { label: 'Undo', onClick: () => void undo().catch(() => invalidate(qc)) },
          });
        },
      },
    );
  };
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, permanent }: { id: string; permanent?: boolean; title?: string }) =>
      api<void>(`/tasks/${id}`, { method: 'DELETE', query: { permanent: permanent ? 'true' : undefined } }),
    onMutate: async ({ id }) => {
      const snap = await snapshot(qc);
      removeTaskEverywhere(qc, id);
      return { snap };
    },
    onError: (_e, _v, ctx) => restore(qc, ctx?.snap),
    onSuccess: (_r, { id, permanent, title }) => {
      if (permanent) return;
      toast('Moved to trash', {
        description: title,
        action: {
          label: 'Undo',
          onClick: () => void api(`/tasks/${id}/restore`, { method: 'POST' }).then(() => invalidate(qc)),
        },
      });
    },
    onSettled: () => invalidate(qc),
  });
}

export function useRestoreTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ task: TaskDTO }>(`/tasks/${id}/restore`, { method: 'POST' }),
    onSuccess: () => toast.success('Task restored'),
    onSettled: () => invalidate(qc),
  });
}

export function useEmptyTrash() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ deleted: number }>('/tasks/trash', { method: 'DELETE' }),
    onSuccess: (r) => toast.success(`Deleted ${r.deleted} task${r.deleted === 1 ? '' : 's'} permanently`),
    onSettled: () => invalidate(qc),
  });
}

export function useBulkTasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BulkTaskInput) => api<{ updated: number }>('/tasks/bulk', { method: 'POST', body: input }),
    onSuccess: (r, input) => toast.success(`${r.updated} task${r.updated === 1 ? '' : 's'} updated`, { description: input.action }),
    onSettled: () => invalidate(qc),
  });
}

export function useSubtaskMutations(taskId: string) {
  const qc = useQueryClient();
  const patchSubs = (fn: (subs: SubtaskDTO[]) => SubtaskDTO[]) =>
    patchTaskEverywhere(qc, taskId, (t) => ({ ...t, subtasks: fn(t.subtasks) }));
  const common = { onSettled: () => void qc.invalidateQueries({ queryKey: keys.tasks.all }) };

  const add = useMutation({
    mutationFn: (title: string) => api<{ subtask: SubtaskDTO }>(`/tasks/${taskId}/subtasks`, { method: 'POST', body: { title } }),
    onSuccess: ({ subtask }) => patchSubs((s) => [...s, subtask]),
    ...common,
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<Pick<SubtaskDTO, 'title' | 'done'>> }) =>
      api<{ subtask: SubtaskDTO }>(`/tasks/${taskId}/subtasks/${id}`, { method: 'PATCH', body: input }),
    onMutate: ({ id, input }) => patchSubs((s) => s.map((x) => (x.id === id ? { ...x, ...input } : x))),
    ...common,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/tasks/${taskId}/subtasks/${id}`, { method: 'DELETE' }),
    onMutate: (id) => patchSubs((s) => s.filter((x) => x.id !== id)),
    ...common,
  });
  return { add, update, remove };
}
