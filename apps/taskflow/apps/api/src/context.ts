import type { Env } from './config/env';
import type { Database, Db } from './db/client';
import type { Logger } from './lib/logger';
import type { AuditService } from './modules/audit/audit.service';
import type { RealtimeBus } from './realtime/bus';

/** Explicit dependency container passed to routers/services — no hidden singletons. */
export interface AppContext {
  env: Env;
  database: Database;
  db: Db;
  logger: Logger;
  bus: RealtimeBus;
  audit: AuditService;
}
