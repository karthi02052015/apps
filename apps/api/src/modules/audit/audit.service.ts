import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm';
import type { AuditLogDTO, Page } from '@taskflow/shared';
import type { Db, DbOrTx } from '../../db/client';
import { auditLogs } from '../../db/schema';
import { decodeCursor, encodeCursor } from '../../lib/cursor';
import type { RequestMeta } from '../../lib/http';
import type { Logger } from '../../lib/logger';

export interface AuditEntry {
  action: string;
  userId?: string | null;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  meta?: RequestMeta;
}

type AuditCursor = { t: string; id: string };
const isCursor = (v: unknown): v is AuditCursor =>
    typeof v === 'object' &&
  v !== null &&
  typeof (v as AuditCursor).t === 'string' &&
  !Number.isNaN(Date.parse((v as AuditCursor).t)) &&
  typeof (v as AuditCursor).id === 'string' &&
  /^[0-9a-f-]{36}$/i.test((v as AuditCursor).id);

export class AuditService {
  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
  ) {}

  /**
   * Record an audit event. Failures are logged but never break the request —
   * the structured log line is the fallback trail.
   */
  async record(entry: AuditEntry, tx: DbOrTx = this.db): Promise<void> {
    try {
      await tx.insert(auditLogs).values({
        action: entry.action,
        userId: entry.userId ?? null,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        metadata: entry.metadata ?? null,
        ip: entry.meta?.ip ?? null,
        userAgent: entry.meta?.userAgent ?? null,
      });
    } catch (err) {
      this.logger.error({ err, audit: { ...entry, meta: undefined } }, 'failed to write audit log');
    }
  }

  async list(opts: { userId?: string; action?: string; cursor?: string; limit: number }): Promise<Page<AuditLogDTO>> {
    const where: SQL[] = [];
    if (opts.userId) where.push(eq(auditLogs.userId, opts.userId));
    if (opts.action) where.push(eq(auditLogs.action, opts.action));
    if (opts.cursor) {
      const c = decodeCursor(opts.cursor, isCursor);
      const t = new Date(c.t);
      where.push(or(lt(auditLogs.createdAt, t), and(eq(auditLogs.createdAt, t), lt(auditLogs.id, c.id)))!);
    }
    const rows = await this.db
      .select()
      .from(auditLogs)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(opts.limit + 1);
    const page = rows.slice(0, opts.limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => ({
        id: r.id,
        userId: r.userId,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        ip: r.ip,
        metadata: r.metadata ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: rows.length > opts.limit && last ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id }) : null,
    };
  }
}
