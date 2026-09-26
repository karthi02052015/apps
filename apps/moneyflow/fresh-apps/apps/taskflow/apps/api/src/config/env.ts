import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? def : v === 'true' || v === '1'));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('0.0.0.0'),

  /** postgres://… for PostgreSQL. When omitted, embedded PGlite is used (dev/test only). */
  DATABASE_URL: z.string().url().optional(),
  /** PGlite data directory, or "memory://" for an ephemeral in-memory database. */
  PGLITE_DATA_DIR: z.string().default('./.data/pglite'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DATABASE_SSL: bool(false),
  /** Apply pending migrations at boot. Disable for multi-replica deploys and run `db:migrate` as a release step. */
  AUTO_MIGRATE: bool(true),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters').optional(),
  JWT_ISSUER: z.string().default('taskflow'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),

  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  /** Number of reverse-proxy hops to trust for client IPs (0 = none). */
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
  /** Secure cookies + HTTPS upgrades. Defaults to true in production; set false only for local http testing. */
  COOKIE_SECURE: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true' || v === '1')),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** When set, /metrics requires `Authorization: Bearer <token>`. */
  METRICS_TOKEN: z.string().min(16).optional(),

  SCHEDULER_ENABLED: bool(true),
  SCHEDULER_INTERVAL_MS: z.coerce.number().int().min(5_000).default(30_000),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(20),

  /** Optional: absolute/relative path to the built web app to serve from the API (single-container deploys). */
  WEB_DIST_DIR: z.string().optional(),
});

export type Env = Omit<z.infer<typeof EnvSchema>, 'COOKIE_SECURE'> & { JWT_SECRET: string; COOKIE_SECURE: boolean };

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;

  if (env.NODE_ENV === 'production') {
    const problems: string[] = [];
    if (!env.JWT_SECRET) problems.push('JWT_SECRET is required in production');
    if (!env.DATABASE_URL) problems.push('DATABASE_URL (PostgreSQL) is required in production');
    if (problems.length) throw new Error(`Invalid production configuration:\n  • ${problems.join('\n  • ')}`);
  }

  // Dev/test convenience: an ephemeral secret means tokens die on restart, which is fine locally.
  const JWT_SECRET = env.JWT_SECRET ?? randomBytes(48).toString('base64url');
  if (!env.JWT_SECRET && env.NODE_ENV === 'development') {
    console.warn('[taskflow] JWT_SECRET not set — using an ephemeral secret. Sessions reset on restart.');
  }

  return {
    ...env,
    JWT_SECRET,
    COOKIE_SECURE: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
  };
}

export const corsOrigins = (env: Env): string[] =>
  env.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
