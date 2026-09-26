import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import {
  startOfZonedDay,
  type AuthResponse,
  type ChangePasswordInput,
  type LoginInput,
  type RegisterInput,
  type SessionDTO,
  type UpdateProfileInput,
  type UserDTO,
} from '@taskflow/shared';
import type { AppContext } from '../../context';
import { rowsOf, type DbOrTx } from '../../db/client';
import { projects, sessions, subtasks, tasks, users, type Session, type User } from '../../db/schema';
import { AppError } from '../../lib/errors';
import type { RequestMeta } from '../../lib/http';
import { getDummyHash, hashPassword, needsRehash, verifyPassword } from '../../lib/password';
import { generateRefreshToken, hashToken, signAccessToken } from '../../lib/tokens';
import { metrics } from '../../observability/metrics';

const MAX_FAILED_LOGINS = 10;
const LOCKOUT_MS = 15 * 60_000;
/** Concurrent refreshes (two tabs) within this window are benign, not token theft. */
const ROTATION_GRACE_MS = 5_000;

class RotationConflict extends Error {}

export interface IssuedSession extends AuthResponse {
  refreshToken: string;
  refreshExpiresAt: Date;
}

export const toUserDTO = (u: User): UserDTO => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  timezone: u.timezone,
  createdAt: u.createdAt.toISOString(),
});

export class AuthService {
  constructor(private readonly ctx: AppContext) {}

  private get db() {
    return this.ctx.db;
  }

  async register(input: RegisterInput, meta: RequestMeta): Promise<IssuedSession> {
    const passwordHash = await hashPassword(input.password);
    const existing = await this.db.query.users.findFirst({ where: sql`lower(${users.email}) = ${input.email}` });
    if (existing) throw AppError.conflict('An account with this email already exists. Try signing in instead.');

    const user = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({ email: input.email, name: input.name, passwordHash, timezone: input.timezone ?? 'UTC' })
        .returning();
      await seedStarterContent(tx, created!.id, created!.timezone);
      return created!;
    });

    await this.ctx.audit.record({ action: 'auth.register', userId: user.id, entityType: 'user', entityId: user.id, meta });
    metrics.authEvents.inc({ event: 'register' });
    return this.issueSession(user, meta, randomUUID());
  }

  async login(input: LoginInput, meta: RequestMeta): Promise<IssuedSession> {
    const user = await this.db.query.users.findFirst({ where: sql`lower(${users.email}) = ${input.email}` });

    if (!user) {
      // Equalise timing so response latency does not reveal which emails exist.
      await verifyPassword(input.password, await getDummyHash());
      await this.ctx.audit.record({ action: 'auth.login_failed', metadata: { reason: 'unknown_email' }, meta });
      metrics.authEvents.inc({ event: 'login_failed' });
      throw AppError.unauthenticated('Incorrect email or password.');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.ctx.audit.record({ action: 'auth.login_locked', userId: user.id, meta });
      throw AppError.locked(Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000));
    }

    const ok = await verifyPassword(input.password, user.passwordHash);
    if (!ok) {
      // Single atomic statement: parallel wrong guesses can't race past the lockout threshold.
      const rows = rowsOf<{ failed: number; locked: boolean }>(
        await this.db.execute(sql`
          update ${users}
          set failed_login_count = case when failed_login_count + 1 >= ${MAX_FAILED_LOGINS} then 0 else failed_login_count + 1 end,
              locked_until = case when failed_login_count + 1 >= ${MAX_FAILED_LOGINS}
                                  then now() + make_interval(secs => ${LOCKOUT_MS / 1000}) else locked_until end
          where id = ${user.id}
          returning failed_login_count as failed, (locked_until is not null and locked_until > now()) as locked`),
      );
      const lock = rows[0]?.locked ?? false;
      await this.ctx.audit.record({
        action: lock ? 'auth.account_locked' : 'auth.login_failed',
        userId: user.id,
        metadata: { failedAttempts: lock ? MAX_FAILED_LOGINS : rows[0]?.failed },
        meta,
      });
      metrics.authEvents.inc({ event: 'login_failed' });
      throw AppError.unauthenticated('Incorrect email or password.');
    }

    const updates: Partial<typeof users.$inferInsert> = { failedLoginCount: 0, lockedUntil: null };
    if (needsRehash(user.passwordHash)) updates.passwordHash = await hashPassword(input.password);
    await this.db.update(users).set(updates).where(eq(users.id, user.id));

    await this.ctx.audit.record({ action: 'auth.login', userId: user.id, meta });
    metrics.authEvents.inc({ event: 'login' });
    return this.issueSession(user, meta, randomUUID());
  }

  /**
   * Rotate a refresh token. Returns `refreshToken: null` when a concurrent
   * refresh already rotated it (the browser holds the newer cookie).
   */
  async refresh(
    token: string | undefined,
    meta: RequestMeta,
  ): Promise<Omit<IssuedSession, 'refreshToken'> & { refreshToken: string | null }> {
    if (!token) throw AppError.unauthenticated();
    const session = await this.db.query.sessions.findFirst({ where: eq(sessions.tokenHash, hashToken(token)) });
    if (!session) throw AppError.unauthenticated();

    const user = await this.db.query.users.findFirst({ where: eq(users.id, session.userId) });
    if (!user) throw AppError.unauthenticated();

    if (session.revokedAt) {
      const grace = await this.graceResult(session, user, meta);
      if (grace) return grace;
      // Revoked by logout/revocation (not rotation): simply no longer valid.
      if (!session.replacedById) throw AppError.unauthenticated();
      // Replay of a rotated token: assume theft and kill the whole family.
      await this.db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.familyId, session.familyId), isNull(sessions.revokedAt)));
      await this.ctx.audit.record({
        action: 'auth.refresh_reuse_detected',
        userId: user.id,
        entityType: 'session',
        entityId: session.id,
        meta,
      });
      metrics.authEvents.inc({ event: 'refresh_reuse' });
      throw AppError.unauthenticated('Your session was ended for security reasons. Please sign in again.');
    }

    if (session.expiresAt <= new Date()) throw AppError.unauthenticated('Your session has expired. Please sign in again.');

    try {
      const issued = await this.issueSession(user, meta, session.familyId, session.id);
      metrics.authEvents.inc({ event: 'refresh' });
      return issued;
    } catch (err) {
      // Lost a race with a concurrent refresh of the same token: answer via the grace path
      // (no new cookie) so the winner's freshly-set cookie is left intact.
      if (err instanceof RotationConflict) {
        const rotated = await this.db.query.sessions.findFirst({ where: eq(sessions.id, session.id) });
        const grace = rotated && (await this.graceResult(rotated, user, meta));
        if (grace) return grace;
        throw AppError.unauthenticated();
      }
      throw err;
    }
  }

  /**
   * Two tabs refreshing at once present the same token twice. Within a short
   * window, from the same user agent, the second caller gets an access token for
   * the replacement session (no new cookie — the browser already holds it).
   */
  private async graceResult(session: Session, user: User, meta: RequestMeta) {
    if (!session.revokedAt || !session.replacedById) return null;
    if (Date.now() - session.revokedAt.getTime() >= ROTATION_GRACE_MS) return null;
    if (session.userAgent && meta.userAgent && session.userAgent !== meta.userAgent) return null;
    const replacement = await this.db.query.sessions.findFirst({
      where: and(eq(sessions.id, session.replacedById), isNull(sessions.revokedAt)),
    });
    if (!replacement) return null;
    await this.ctx.audit.record({ action: 'auth.refresh_grace', userId: user.id, entityType: 'session', entityId: session.id, meta });
    return {
      user: toUserDTO(user),
      accessToken: signAccessToken(this.ctx.env, { sub: user.id, role: user.role, sid: replacement.id }),
      expiresIn: this.ctx.env.ACCESS_TOKEN_TTL_SECONDS,
      refreshToken: null,
      refreshExpiresAt: replacement.expiresAt,
    };
  }

  async logout(token: string | undefined, meta: RequestMeta): Promise<void> {
    if (!token) return;
    const [revoked] = await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)))
      .returning({ userId: sessions.userId, id: sessions.id });
    if (revoked) {
      this.ctx.bus.publish(revoked.userId, { type: 'session.revoked', sessionIds: [revoked.id] });
      await this.ctx.audit.record({ action: 'auth.logout', userId: revoked.userId, entityType: 'session', entityId: revoked.id, meta });
    }
  }

  async logoutAll(userId: string, meta: RequestMeta): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    this.ctx.bus.publish(userId, { type: 'session.revoked', sessionIds: 'all' });
    await this.ctx.audit.record({ action: 'auth.logout_all', userId, meta });
  }

  async me(userId: string): Promise<UserDTO> {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw AppError.unauthenticated();
    return toUserDTO(user);
  }

  async updateProfile(userId: string, input: UpdateProfileInput, meta: RequestMeta): Promise<UserDTO> {
    const [user] = await this.db.update(users).set(input).where(eq(users.id, userId)).returning();
    if (!user) throw AppError.unauthenticated();
    await this.ctx.audit.record({ action: 'user.update_profile', userId, metadata: { fields: Object.keys(input) }, meta });
    return toUserDTO(user);
  }

  async changePassword(userId: string, sessionId: string, input: ChangePasswordInput, meta: RequestMeta): Promise<void> {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw AppError.unauthenticated();
    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
      await this.ctx.audit.record({ action: 'auth.change_password_failed', userId, meta });
      throw AppError.badRequest('Current password is incorrect.', [{ path: 'currentPassword', message: 'Incorrect password' }]);
    }
    const passwordHash = await hashPassword(input.newPassword);
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash }).where(eq(users.id, userId));
      // Sign out every other device — a password change usually means "I think someone else has access".
      await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), sql`${sessions.id} <> ${sessionId}`));
    });
    this.ctx.bus.publish(userId, { type: 'session.revoked', sessionIds: 'all', except: sessionId });
    await this.ctx.audit.record({ action: 'auth.change_password', userId, meta });
  }

  async listSessions(userId: string, currentSessionId: string): Promise<SessionDTO[]> {
    const rows = await this.db.query.sessions.findMany({
      where: and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())),
      orderBy: (s, { desc }) => [desc(s.lastUsedAt)],
      limit: 50,
    });
    return rows.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      current: s.id === currentSessionId,
    }));
  }

  async revokeSession(userId: string, sessionId: string, meta: RequestMeta): Promise<void> {
    const [row] = await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    if (!row) throw AppError.notFound('Session');
    this.ctx.bus.publish(userId, { type: 'session.revoked', sessionIds: [sessionId] });
    await this.ctx.audit.record({ action: 'auth.revoke_session', userId, entityType: 'session', entityId: sessionId, meta });
  }

  private async issueSession(user: User, meta: RequestMeta, familyId: string, rotateFromId?: string): Promise<IssuedSession> {
    const refreshToken = generateRefreshToken();
    const refreshExpiresAt = new Date(Date.now() + this.ctx.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);

    const session = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(sessions)
        .values({
          userId: user.id,
          tokenHash: hashToken(refreshToken),
          familyId,
          expiresAt: refreshExpiresAt,
          userAgent: meta.userAgent,
          ip: meta.ip,
        })
        .returning({ id: sessions.id });
      if (rotateFromId) {
        const [old] = await tx
          .update(sessions)
          .set({ revokedAt: new Date(), replacedById: created!.id, lastUsedAt: new Date() })
          .where(and(eq(sessions.id, rotateFromId), isNull(sessions.revokedAt)))
          .returning({ id: sessions.id });
        // Lost a race with a concurrent rotation: roll back and let refresh() use the grace path.
        if (!old) throw new RotationConflict();
      }
      return created!;
    });

    return {
      user: toUserDTO(user),
      accessToken: signAccessToken(this.ctx.env, { sub: user.id, role: user.role, sid: session.id }),
      expiresIn: this.ctx.env.ACCESS_TOKEN_TTL_SECONDS,
      refreshToken,
      refreshExpiresAt,
    };
  }
}

/** A friendly first-run experience: new users land on a board that teaches the app. */
async function seedStarterContent(tx: DbOrTx, userId: string, timeZone: string): Promise<void> {
  const [project] = await tx
    .insert(projects)
    .values({ userId, name: 'Getting started', color: '#6366f1', icon: 'sparkles', position: 1 })
    .returning({ id: projects.id });
  const now = Date.now();
  const starter = [
    { title: 'Welcome to TaskFlow — tick me off when you have read this', priority: 2 },
    { title: 'Try quick add: type "Call Sam tomorrow 4pm #work !high" in the box above', priority: 3 },
    { title: 'Press ⌘K / Ctrl+K to search and jump anywhere', priority: 0 },
    { title: 'Drag tasks between columns in Board view', priority: 0 },
  ];
  const inserted = await tx
    .insert(tasks)
    .values(
      starter.map((t, i) => ({
        userId,
        projectId: project!.id,
        title: t.title,
        priority: t.priority,
        position: now + i,
        // All-day "today" so it shows in Today without instantly being overdue.
        dueAt: i === 0 ? startOfZonedDay(new Date(now), timeZone) : null,
        allDay: i === 0,
      })),
    )
    .returning({ id: tasks.id });
  await tx.insert(subtasks).values([
    { taskId: inserted[0]!.id, title: 'Open a task to see details', position: 1 },
    { taskId: inserted[0]!.id, title: 'Add a subtask of your own', position: 2 },
  ]);
}
