import { z } from 'zod';
import type { NotificationType } from '../constants';
import { idSchema } from './common';

export const markNotificationsReadSchema = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ ids: z.array(idSchema).min(1).max(200) }),
]);
export type MarkNotificationsReadInput = z.infer<typeof markNotificationsReadSchema>;

export interface NotificationDTO {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  taskId: string | null;
  readAt: string | null;
  createdAt: string;
}

/** Events pushed over the realtime stream (Server-Sent Events). */
export type RealtimeEvent =
  | { type: 'notification'; notification: NotificationDTO }
  | { type: 'tasks.changed'; taskIds: string[] }
  | { type: 'projects.changed' }
  /** Server-internal: tells open streams of revoked sessions to close. Never forwarded to clients. */
  | { type: 'session.revoked'; sessionIds: string[] | 'all'; except?: string }
  | { type: 'ping' };

export interface AuditLogDTO {
  id: string;
  userId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  ip: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}
