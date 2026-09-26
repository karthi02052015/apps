import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { NotificationDTO } from '@taskflow/shared';
import { toast } from 'sonner';
import { useAuth } from '../auth/AuthProvider';
import { keys } from '../../lib/keys';
import { connectRealtime } from '../../lib/realtime';
import { storage } from '../../lib/storage';

export const DESKTOP_NOTIFICATIONS_KEY = 'taskflow.desktopNotifications';

function showDesktop(n: NotificationDTO) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (storage.get(DESKTOP_NOTIFICATIONS_KEY) === 'off' || document.visibilityState === 'visible') return;
  try {
    const note = new Notification(n.title, { body: n.body ?? undefined, tag: n.id, icon: '/favicon.svg' });
    note.onclick = () => {
      window.focus();
      if (n.taskId) window.location.assign(`/today?task=${n.taskId}`);
    };
  } catch {
    /* some browsers require a service worker for notifications — ignore */
  }
}

/** Keeps caches fresh from server-pushed events; debounces bursts into one refetch. */
export function useRealtime() {
  const { status } = useAuth();
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (status !== 'authenticated') return;
    const invalidateTasks = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void qc.invalidateQueries({ queryKey: keys.tasks.all });
        void qc.invalidateQueries({ queryKey: keys.stats });
        void qc.invalidateQueries({ queryKey: keys.projects });
        void qc.invalidateQueries({ queryKey: keys.tags });
      }, 400);
    };
    const stop = connectRealtime((e) => {
      switch (e.type) {
        case 'tasks.changed':
        case 'projects.changed':
          invalidateTasks();
          break;
        case 'notification':
          void qc.invalidateQueries({ queryKey: keys.notifications });
          toast(e.notification.title, { description: e.notification.body ?? undefined });
          showDesktop(e.notification);
          break;
      }
    }, setConnected);
    return () => {
      stop();
      clearTimeout(timer.current);
    };
  }, [status, qc]);

  return connected;
}
