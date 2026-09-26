import { and, isNotNull, lt, sql } from 'drizzle-orm';
import type { AppContext } from '../../context';
import { rowsOf } from '../../db/client';
import { sessions, tasks } from '../../db/schema';
import { metrics } from '../../observability/metrics';
import { NotificationsService } from './notifications.service';

const BATCH = 200;
const TRASH_RETENTION_DAYS = 30;

interface ClaimedTask {
  id: string;
  user_id: string;
  title: string;
}

/**
 * Background scheduler: reminders, overdue alerts and housekeeping.
 *
 * Safe to run on many replicas at once — each task is *claimed* with an
 * atomic UPDATE … WHERE sent_at IS NULL … FOR UPDATE SKIP LOCKED, so exactly
 * one instance notifies for it.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private readonly notifications: NotificationsService;
  private lastHousekeeping = 0;

  constructor(private readonly ctx: AppContext) {
    this.notifications = new NotificationsService(ctx);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.ctx.env.SCHEDULER_INTERVAL_MS);
    this.timer.unref();
    void this.tick();
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    // Let an in-flight tick finish so we don't cut a transaction in half on shutdown.
    for (let i = 0; this.running && i < 50; i++) await new Promise((r) => setTimeout(r, 100));
  }

  /** One scheduler pass. Public so tests (and ops tooling) can drive it deterministically. */
  async tick(now = new Date()): Promise<{ reminders: number; overdue: number }> {
    if (this.running) return { reminders: 0, overdue: 0 };
    this.running = true;
    try {
      const reminders = await this.sendReminders(now);
      const overdue = await this.sendOverdue(now);
      if (now.getTime() - this.lastHousekeeping > 3_600_000) {
        await this.housekeeping(now);
        this.lastHousekeeping = now.getTime();
      }
      metrics.schedulerRuns.inc({ outcome: 'ok' });
      return { reminders, overdue };
    } catch (err) {
      metrics.schedulerRuns.inc({ outcome: 'error' });
      this.ctx.logger.error({ err }, 'scheduler tick failed');
      return { reminders: 0, overdue: 0 };
    } finally {
      this.running = false;
    }
  }

  private async sendReminders(now: Date): Promise<number> {
    return this.ctx.db.transaction(async (tx) => {
      const claimed = rowsOf<ClaimedTask>(
        await tx.execute(sql`
          update ${tasks} set reminder_sent_at = ${now}
          where id in (
            select id from ${tasks}
            where remind_at <= ${now} and reminder_sent_at is null and deleted_at is null and status <> 'done'
            order by remind_at
            limit ${BATCH}
            for update skip locked
          )
          returning id, user_id, title`),
      );
      for (const t of claimed) {
        await this.notifications.create(tx, { userId: t.user_id, taskId: t.id, type: 'reminder', title: 'Reminder', body: t.title });
      }
      if (claimed.length) metrics.notificationsSent.inc({ type: 'reminder' }, claimed.length);
      return claimed.length;
    });
  }

  private async sendOverdue(now: Date): Promise<number> {
    return this.ctx.db.transaction(async (tx) => {
      // All-day tasks become overdue at the end of their (local) day, timed tasks at their moment.
      // Only look back a week so a long-idle account isn't flooded on first run.
      const claimed = rowsOf<ClaimedTask>(
        await tx.execute(sql`
          update ${tasks} set overdue_notified_at = ${now}
          where id in (
            select id from ${tasks}
            where due_at is not null and overdue_notified_at is null and deleted_at is null and status <> 'done'
              and due_at > ${now}::timestamptz - interval '7 days'
              and ((all_day and due_at + interval '1 day' <= ${now}) or (not all_day and due_at <= ${now}))
            order by due_at
            limit ${BATCH}
            for update skip locked
          )
          returning id, user_id, title`),
      );
      for (const t of claimed) {
        await this.notifications.create(tx, { userId: t.user_id, taskId: t.id, type: 'overdue', title: 'Task overdue', body: t.title });
      }
      if (claimed.length) metrics.notificationsSent.inc({ type: 'overdue' }, claimed.length);
      return claimed.length;
    });
  }

  private async housekeeping(now: Date): Promise<void> {
    const trashCutoff = new Date(now.getTime() - TRASH_RETENTION_DAYS * 86_400_000);
    const purged = await this.ctx.db
      .delete(tasks)
      .where(and(isNotNull(tasks.deletedAt), lt(tasks.deletedAt, trashCutoff)))
      .returning({ id: tasks.id });
    const sessionCutoff = new Date(now.getTime() - 7 * 86_400_000);
    const expired = await this.ctx.db.delete(sessions).where(lt(sessions.expiresAt, sessionCutoff)).returning({ id: sessions.id });
    this.ctx.logger.info({ purgedTasks: purged.length, expiredSessions: expired.length }, 'housekeeping complete');
  }
}
