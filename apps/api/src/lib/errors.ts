import type { ApiErrorCode } from '@taskflow/shared';

export interface ErrorDetail {
  path: string;
  message: string;
}

/** An error that is safe to show to API clients. Anything else becomes a generic 500. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: ErrorDetail[],
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static badRequest(message: string, details?: ErrorDetail[]) {
    return new AppError(422, 'VALIDATION_ERROR', message, details);
  }
  static unauthenticated(message = 'Please sign in to continue.') {
    return new AppError(401, 'UNAUTHENTICATED', message);
  }
  static forbidden(message = "You don't have access to this resource.") {
    return new AppError(403, 'FORBIDDEN', message);
  }
  static notFound(entity = 'Resource') {
    return new AppError(404, 'NOT_FOUND', `${entity} not found.`);
  }
  static conflict(message: string) {
    return new AppError(409, 'CONFLICT', message);
  }
  static locked(retryAfterSeconds: number) {
    return new AppError(
      423,
      'ACCOUNT_LOCKED',
      'Too many failed sign-in attempts. Try again in a few minutes.',
      undefined,
      { 'Retry-After': String(retryAfterSeconds) },
    );
  }
}

/** PostgreSQL error codes we translate into client errors. */
export const PG = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  INVALID_TEXT: '22P02',
  INVALID_DATETIME: '22007',
  DATETIME_OVERFLOW: '22008',
} as const;

export function pgErrorCode(err: unknown): string | undefined {
  // node-postgres puts `code` on the error; drizzle wraps it in `cause`.
  let e: unknown = err;
  for (let i = 0; i < 3 && e && typeof e === 'object'; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}
