import type { Server } from 'node:http';
import { createApp } from './app';
import { createContext, disposeContext } from './bootstrap';
import { loadEnv } from './config/env';
import { createLogger } from './lib/logger';
import { Scheduler } from './modules/notifications/scheduler';

const env = loadEnv();
const logger = createLogger(env);

async function main() {
  const ctx = await createContext(env, logger);
  const app = createApp(ctx);
  const scheduler = new Scheduler(ctx);
  if (env.SCHEDULER_ENABLED) scheduler.start();

  const server: Server = app.listen(env.PORT, env.HOST, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV, db: ctx.database.kind }, 'TaskFlow API listening');
  });
  // Slightly above typical load-balancer idle timeouts to avoid 502s on keep-alive reuse.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 30_000;

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down gracefully');
    const force = setTimeout(() => {
      logger.error('forced shutdown after timeout');
      process.exit(1);
    }, 15_000).unref();
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeIdleConnections();
    // Give in-flight requests a moment, then drop long-lived SSE streams (clients auto-reconnect elsewhere).
    await Promise.race([closed, new Promise((r) => setTimeout(r, 5_000))]);
    server.closeAllConnections();
    await closed;
    await scheduler.stop();
    await disposeContext(ctx);
    clearTimeout(force);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled promise rejection'));
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception — exiting');
  process.exit(1);
});

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
