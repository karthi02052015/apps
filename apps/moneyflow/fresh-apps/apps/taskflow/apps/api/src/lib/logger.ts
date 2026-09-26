import pino, { type Logger } from 'pino';
import type { Env } from '../config/env';

export type { Logger };

export function createLogger(env: Pick<Env, 'LOG_LEVEL' | 'NODE_ENV'>): Logger {
  const pretty = env.NODE_ENV === 'development' && process.stdout.isTTY;
  return pino({
    level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
    base: { service: 'taskflow-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    // Never let credentials or tokens reach log storage.
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.password',
        '*.currentPassword',
        '*.newPassword',
        '*.passwordHash',
        '*.accessToken',
        '*.refreshToken',
        '*.token',
      ],
      censor: '[redacted]',
    },
    ...(pretty ? { transport: { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss' } } } : {}),
  });
}
