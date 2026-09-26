/** CLI: apply pending migrations. `npm run db:migrate` */
import { loadEnv } from '../config/env';
import { createLogger } from '../lib/logger';
import { createDatabase } from './client';

const env = loadEnv();
const logger = createLogger(env);
const database = await createDatabase(env, logger);
try {
  await database.migrate();
  logger.info({ kind: database.kind }, 'migrations applied');
} finally {
  await database.close();
}
