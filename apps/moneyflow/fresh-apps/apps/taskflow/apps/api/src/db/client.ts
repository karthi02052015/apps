import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { Env } from '../config/env';
import type { Logger } from '../lib/logger';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
/** A transaction handle has the same query surface as the database. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export interface Database {
  db: Db;
  kind: 'postgres' | 'pglite';
  /** Connection string for LISTEN/NOTIFY (postgres only). */
  url?: string;
  migrate(): Promise<void>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

/** Locate apps/api/drizzle whether running from src (tsx) or dist (bundled). */
export function migrationsFolder(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, 'drizzle');
    if (existsSync(path.join(candidate, 'meta', '_journal.json'))) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error('Could not locate the drizzle migrations folder');
}

export async function createDatabase(
  env: Pick<Env, 'DATABASE_URL' | 'PGLITE_DATA_DIR' | 'DATABASE_POOL_MAX' | 'DATABASE_SSL'>,
  logger?: Logger,
): Promise<Database> {
  if (env.DATABASE_URL) {
    const { default: pg } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const pool = new pg.Pool({
      connectionString: env.DATABASE_URL,
      max: env.DATABASE_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      // Kill runaway queries instead of letting them pile up.
      statement_timeout: 15_000,
      ssl: env.DATABASE_SSL ? { rejectUnauthorized: true } : undefined,
    });
    pool.on('error', (err) => logger?.error({ err }, 'postgres pool error'));
    const db = drizzle(pool, { schema }) as unknown as Db;
    return {
      db,
      kind: 'postgres',
      url: env.DATABASE_URL,
      migrate: () => migrate(drizzle(pool, { schema }), { migrationsFolder: migrationsFolder() }),
      ping: async () => {
        await db.execute(sql`select 1`);
      },
      close: () => pool.end(),
    };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const dataDir = env.PGLITE_DATA_DIR;
  if (!dataDir.startsWith('memory://')) await mkdir(path.resolve(dataDir), { recursive: true });
  const client = new PGlite(dataDir.startsWith('memory://') ? undefined : path.resolve(dataDir));
  await client.waitReady;
  const db = drizzle(client, { schema }) as unknown as Db;
  logger?.info({ dataDir }, 'using embedded PGlite database (development mode)');
  return {
    db,
    kind: 'pglite',
    migrate: () => migrate(drizzle(client, { schema }), { migrationsFolder: migrationsFolder() }),
    ping: async () => {
      await db.execute(sql`select 1`);
    },
    close: () => client.close(),
  };
}

/** Normalise `db.execute()` results across drivers (both expose `.rows`). */
export function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}
