import type { z } from 'zod';
import { AppError } from '../lib/errors';

/** Parse untrusted input; throws a 422 with field-level details on failure. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const details = result.error.issues.map((i) => ({
    path: i.path.map(String).join('.') || '(root)',
    message: i.message,
  }));
  throw AppError.badRequest(details[0]?.message ?? 'Invalid request', details);
}
