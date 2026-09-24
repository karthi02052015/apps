import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { MarkNotificationsReadInput, NotificationDTO, NotificationType, Page } from '@taskflow/shared';
import type { AppContext } from '../../context';
import type { DbOrTx } from '../../db/client';
import { notifications, type Notification } from '../../db/schema';
import { decodeCursor, encodeCursor } from '../../lib/cursor';

export const toNotificationDTO = (n: Notification): NotificationDTO => ({
  id: n.id,
  type: n.type,
  title: n.title,
  body: n.body,
  taskId: n.taskId,
  readAt: n.readAt?.toISOString() ?? null,
  createdAt: n.createdAt.toISOString(),
});

type Cursor = { t: string; id: string };
const isCursor = (v: unknown): v is Cursor =>
    typeof v === 'object' &&
  v !== null &&
  typeof (v as Cursor).t === 'string' &&
  !Number.isNaN(Date.parse((v as Cursor).t)) &&
  typeof (v as Cursor).id === 'string' &&
  /^[0-9a-f-]{36}$/i.test((v as Cursor).id);

export class NotificationsService {
  constructor(private readonly ctx: AppContext) {}

  async list(userId: string, opts: { cursor?: string; limit: number; unreadOnly: boolean }) {
    const where = [eq(notifications.userId, userId)];
    if (opts.unreadOnly) where.push(isNull(notifications.readAt));
    if (opts.cursor) {
      const c = decodeCursor(opts.cursor, isCursor);
      const t = new Date(c.t);
      where.push(or(lt(notifications.createdAt, t), and(eq(notifications.createdAt, t), lt(notifications.id, c.id)))!);
    }
    const rows = await this.ctx.db
      .select()
      .from(notifications)
      .where(and(...where))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(opts.limit + 1);
    const page = rows.slice(0, opts.limit);
    const last = page.at(-1);
    const [unread] = await this.ctx.db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    const result: Page<NotificationDTO> & { unreadCount: number } = {
      items: page.map(toNotificationDTO),
      nextCursor: rows.length > opts.limit && last ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id }) : null,
      unreadCount: unread?.n ?? 0,
    };
    return result;
  }

  async markRead(userId: string, input: MarkNotificationsReadInput): Promise<number> {
    const where = [eq(notifications.userId, userId), isNull(notifications.readAt)];
    if ('ids' in input) where.push(inArray(notifications.id, input.ids));
    const rows = await this.ctx.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(...where))
      .returning({ id: notifications.id });
    return rows.length;
  }

  /** Persist and push a notification to every open client of that user. */
  async create(
    db: DbOrTx,
    n: { userId: string; type: NotificationType; title: string; body?: string | null; taskId?: string | null },
  ): Promise<NotificationDTO> {
    const [row] = await db
      .insert(notifications)
      .values({
        userId: n.userId,
        type: n.type,
        title: n.title.slice(0, 200),
        body: n.body?.slice(0, 1000) ?? null,
        taskId: n.taskId ?? null,
      })
      .returning();
    const dto = toNotificationDTO(row!);
    this.ctx.bus.publish(n.userId, { type: 'notification', notification: dto });
    return dto;
  }
}
