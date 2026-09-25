import type { Env } from './config/env';
import type { AppContext } from './context';
import { createDatabase } from './db/client';
import type { Logger } from './lib/logger';
import { AuditService } from './modules/audit/audit.service';
import { InMemoryBus, PostgresBus, type RealtimeBus } from './realtime/bus';

/** Wire up infrastructure. Shared by the server entrypoint and integration tests. */
export async function createContext(env: Env, logger: Logger): Promise<AppContext> {
  const database = await createDatabase(env, logger);
  if (env.AUTO_MIGRATE) await database.migrate();

  let bus: RealtimeBus;
  if (database.kind === 'postgres' && database.url) {
    const pgBus = new PostgresBus(database.url, logger);
    await pgBus.start();
    bus = pgBus;
  } else {
    bus = new InMemoryBus();
  }

  return { env, logger, database, db: database.db, bus, audit: new AuditService(database.db, logger) };
}

export async function disposeContext(ctx: AppContext): Promise<void> {
  await ctx.bus.close();
  await ctx.database.close();
}
