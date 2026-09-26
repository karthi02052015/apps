import { AlertTriangle, Bell, CheckCheck, Info, PartyPopper, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { EmptyState, RowSkeleton } from './ui/Skeleton';
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications } from '@/hooks/queries';
import { relativeDayLabel, timeLabel } from '@/lib/dates';

const SEVERITY = {
  info: { icon: Info, className: 'bg-brand-soft text-brand' },
  success: { icon: PartyPopper, className: 'bg-positive-soft text-positive' },
  warning: { icon: TriangleAlert, className: 'bg-caution-soft text-caution' },
  critical: { icon: AlertTriangle, className: 'bg-negative-soft text-negative' },
} as const;

export function NotificationPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, isLoading } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const items = data?.items ?? [];
  const unread = data?.unread ?? 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Notifications"
      description={unread > 0 ? `${unread} unread` : 'You are all caught up'}
      size="lg"
      footer={
        unread > 0 ? (
          <Button
            variant="outline"
            size="sm"
            leftIcon={<CheckCheck className="h-4 w-4" aria-hidden />}
            onClick={() => markAll.mutate()}
            loading={markAll.isPending}
          >
            Mark all as read
          </Button>
        ) : undefined
      }
    >
      {isLoading ? (
        <RowSkeleton count={4} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Bell className="h-6 w-6" aria-hidden />}
          title="Nothing to report"
          description="Budget warnings, upcoming payments and goal milestones will appear here."
        />
      ) : (
        <ul className="-mx-1 divide-y divide-line">
          {items.map((notification) => {
            const style = SEVERITY[notification.severity] ?? SEVERITY.info;
            const Icon = style.icon;
            const isUnread = notification.readAt === null;
            return (
              <li key={notification.id}>
                <button
                  type="button"
                  onClick={() => isUnread && markRead.mutate(notification.id)}
                  className={cn(
                    'flex w-full gap-3 rounded-xl p-3 text-left transition-colors',
                    isUnread ? 'bg-brand-soft/40 hover:bg-brand-soft/60' : 'hover:bg-surface-2',
                  )}
                >
                  <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', style.className)} aria-hidden>
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-ink">{notification.title}</span>
                      {isUnread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-label="Unread" />}
                    </span>
                    <span className="mt-0.5 block text-sm text-ink-2">{notification.body}</span>
                    <span className="mt-1 block text-xs text-ink-3">
                      {relativeDayLabel(notification.createdAt)} · {timeLabel(notification.createdAt)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
