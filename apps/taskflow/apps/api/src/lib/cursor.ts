import { AppError } from './errors';

/** Opaque, tamper-evident-enough cursor: base64url JSON. Values are re-validated on use. */
export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function decodeCursor<T>(cursor: string, guard: (v: unknown) => v is T): T {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (guard(parsed)) return parsed;
  } catch {
    /* fall through */
  }
  throw AppError.badRequest('Invalid pagination cursor', [{ path: 'cursor', message: 'Invalid cursor' }]);
}
