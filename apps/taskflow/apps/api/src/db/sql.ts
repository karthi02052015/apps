import { getTableName, sql, type Column, type SQL } from 'drizzle-orm';

/**
 * Fully-qualified column reference ("table"."column").
 *
 * Drizzle renders columns unqualified inside SELECT-list expressions, which
 * silently changes meaning in correlated subqueries ("id" binds to the inner
 * table). Use this helper for every column inside such subqueries.
 */
export const col = (c: Column): SQL => sql`${sql.identifier(getTableName(c.table))}.${sql.identifier(c.name)}`;
