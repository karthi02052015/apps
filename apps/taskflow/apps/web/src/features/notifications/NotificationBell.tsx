import * as Popover from '@radix-ui/react-popover';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { AlarmClock, Bell, BellOff, CheckCheck, TriangleAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { NotificationDTO, Page } from '@taskflow/shared';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { keys } from '../../lib/keys';

type NotificationPage = Page<NotificationDTO> & { unreadCount: number };

export function NotificationBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const query = useInfiniteQuery({
    queryKey: keys.notifications,
    queryFn: ({ pageParam, signal }) => api<NotificationPage>('/notifications', { query: { cursor: pageParam ?? undefined }, signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (p) => p.nextCursor,
    refetchInterval: 120_000, // safety net if the realtime stream is unavailable
  });
  const markRead = useMutation({
    mutationFn: (body: { all: true } | { ids: string[] }) => api('/notifications/read', { method: 'POST', body }),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.notifications }),
    meta: { silent: true },
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = query.data?.pages[0]?.unreadCount ?? 0;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} className="relative">
          <Bell className="size-[18px]" />
          {unread ? (
            <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-4 text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          ) : null}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-[min(380px,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-border bg-surface shadow-pop data-[state=open]:animate-fade-in"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-[14px] font-semibold">Notifications</h2>
            {unread ? (
              <Button size="sm" variant="ghost" onClick={() => markRead.mutate({ all: true })}>
                <CheckCheck className="size-3.5" /> Mark all read
              </Button>
            ) : null}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {query.isPending ? (
              <div className="grid place-items-center py-10">
                <Spinner />
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-10 text-center">
                <BellOff className="size-6 text-subtle" aria-hidden />
                <p className="mt-2 text-[13.5px] font-medium">You're all caught up</p>
                <p className="mt-1 text-[12.5px] text-muted">Reminders and overdue alerts will appear here.</p>
              </div>
            ) : (
              <ul>
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      className={cn('flex w-full gap-3 px-4 py-3 text-left hover:bg-surface-2', !n.readAt && 'bg-accent-soft/40')}
                      onClick={() => {
                        if (!n.readAt) markRead.mutate({ ids: [n.id] });
                        if (n.taskId) navigate(`/today?task=${n.taskId}`);
                      }}
                    >
                      <span className={cn('mt-0.5 grid size-7 shrink-0 place-items-center rounded-full', n.type === 'overdue' ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent')}>
                        {n.type === 'overdue' ? <TriangleAlert className="size-3.5" /> : <AlarmClock className="size-3.5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium">{n.title}</span>
                        {n.body ? <span className="block truncate text-[13px] text-muted">{n.body}</span> : null}
                        <span className="mt-0.5 block text-[11.5px] text-subtle">{formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}</span>
                      </span>
                      {!n.readAt ? <span className="mt-2 size-2 shrink-0 rounded-full bg-accent" aria-label="Unread" /> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {query.hasNextPage ? (
              <div className="p-2">
                <Button variant="ghost" size="sm" className="w-full" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                  Load more
                </Button>
              </div>
            ) : null}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
