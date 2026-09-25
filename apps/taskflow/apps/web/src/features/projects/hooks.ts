import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateProjectInput, ProjectDTO, TagDTO, UpdateProjectInput } from '@taskflow/shared';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { keys } from '../../lib/keys';

export function useProjects() {
  return useQuery({
    queryKey: keys.projects,
    queryFn: ({ signal }) => api<{ items: ProjectDTO[] }>('/projects', { signal }).then((r) => r.items),
    staleTime: 60_000,
  });
}

export function useTags() {
  return useQuery({
    queryKey: keys.tags,
    queryFn: ({ signal }) => api<{ items: TagDTO[] }>('/tags', { signal }).then((r) => r.items),
    staleTime: 60_000,
  });
}

export function useProjectMutations() {
  const qc = useQueryClient();
  const settle = () => {
    void qc.invalidateQueries({ queryKey: keys.projects });
    void qc.invalidateQueries({ queryKey: keys.tasks.all });
    void qc.invalidateQueries({ queryKey: keys.stats });
  };
  return {
    create: useMutation({
      mutationFn: (input: CreateProjectInput) => api<{ project: ProjectDTO }>('/projects', { method: 'POST', body: input }).then((r) => r.project),
      onSettled: settle,
    }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: UpdateProjectInput }) =>
        api<{ project: ProjectDTO }>(`/projects/${id}`, { method: 'PATCH', body: input }).then((r) => r.project),
      onSettled: settle,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api<void>(`/projects/${id}`, { method: 'DELETE' }),
      onSuccess: () => toast.success('Project deleted — its tasks moved to Inbox'),
      onSettled: settle,
    }),
  };
}
