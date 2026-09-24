import { and, asc, eq, isNull, max, ne, sql } from 'drizzle-orm';
import type { CreateProjectInput, ProjectDTO, UpdateProjectInput } from '@taskflow/shared';
import type { AppContext } from '../../context';
import { projects, tasks, type Project } from '../../db/schema';
import { col } from '../../db/sql';
import { AppError } from '../../lib/errors';
import type { RequestMeta } from '../../lib/http';

const MAX_PROJECTS = 200;

const toDTO = (p: Project, openTaskCount: number): ProjectDTO => ({
  id: p.id,
  name: p.name,
  color: p.color,
  icon: p.icon,
  position: p.position,
  archivedAt: p.archivedAt?.toISOString() ?? null,
  openTaskCount,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

export class ProjectsService {
  constructor(private readonly ctx: AppContext) {}

  private get db() {
    return this.ctx.db;
  }

  async list(userId: string, includeArchived: boolean): Promise<ProjectDTO[]> {
    const openCount = sql<number>`(
      select count(*) from ${tasks}
      where ${col(tasks.projectId)} = ${col(projects.id)} and ${col(tasks.deletedAt)} is null and ${col(tasks.status)} <> 'done'
    )`.mapWith(Number);
    const rows = await this.db
      .select({ project: projects, openCount })
      .from(projects)
      .where(and(eq(projects.userId, userId), includeArchived ? undefined : isNull(projects.archivedAt)))
      .orderBy(asc(projects.position), asc(projects.createdAt));
    return rows.map((r) => toDTO(r.project, r.openCount));
  }

  async create(userId: string, input: Required<Pick<CreateProjectInput, 'name' | 'color'>> & { icon?: string | null }, meta: RequestMeta) {
    const [{ count, maxPos } = { count: 0, maxPos: 0 }] = await this.db
      .select({ count: sql<number>`count(*)`.mapWith(Number), maxPos: max(projects.position) })
      .from(projects)
      .where(eq(projects.userId, userId));
    if (count >= MAX_PROJECTS) throw AppError.badRequest(`You can have at most ${MAX_PROJECTS} projects.`);
    await this.assertUniqueName(userId, input.name);
    const [row] = await this.db
      .insert(projects)
      .values({ userId, name: input.name, color: input.color, icon: input.icon ?? null, position: (maxPos ?? 0) + 1 })
      .returning();
    await this.ctx.audit.record({ action: 'project.create', userId, entityType: 'project', entityId: row!.id, meta });
    this.ctx.bus.publish(userId, { type: 'projects.changed' });
    return toDTO(row!, 0);
  }

  async update(userId: string, id: string, input: UpdateProjectInput, meta: RequestMeta): Promise<ProjectDTO> {
    if (input.name) await this.assertUniqueName(userId, input.name, id);
    const { archived, ...rest } = input;
    const [row] = await this.db
      .update(projects)
      .set({ ...rest, ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}) })
      .where(and(eq(projects.id, id), eq(projects.userId, userId)))
      .returning();
    if (!row) throw AppError.notFound('Project');
    await this.ctx.audit.record({ action: 'project.update', userId, entityType: 'project', entityId: id, meta });
    this.ctx.bus.publish(userId, { type: 'projects.changed' });
    const [c] = await this.db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(tasks)
      .where(and(eq(tasks.projectId, id), isNull(tasks.deletedAt), ne(tasks.status, 'done')));
    return toDTO(row, c?.n ?? 0);
  }

  /** Deleting a project keeps its tasks: they move to the Inbox (FK ON DELETE SET NULL). */
  async remove(userId: string, id: string, meta: RequestMeta): Promise<void> {
    const deleted = await this.db
      .delete(projects)
      .where(and(eq(projects.id, id), eq(projects.userId, userId)))
      .returning({ id: projects.id });
    if (!deleted.length) throw AppError.notFound('Project');
    await this.ctx.audit.record({ action: 'project.delete', userId, entityType: 'project', entityId: id, meta });
    this.ctx.bus.publish(userId, { type: 'projects.changed' });
    this.ctx.bus.publish(userId, { type: 'tasks.changed', taskIds: [] });
  }

  private async assertUniqueName(userId: string, name: string, exceptId?: string) {
    const [clash] = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.userId, userId),
          sql`lower(${projects.name}) = lower(${name})`,
          exceptId ? ne(projects.id, exceptId) : undefined,
        ),
      );
    if (clash) throw AppError.conflict(`You already have a project called "${name}".`);
  }
}
