/**
 * The one error type the UI understands.
 *
 * Forms read `details` to highlight the offending field; everything else shows
 * `message`. The engine throws these, the UI catches them — there is no
 * network layer in between, so there is nothing else an error can be.
 */
export interface FieldIssue {
  field: string;
  message: string;
}

export class AppError extends Error {
  readonly details: FieldIssue[];

  constructor(message: string, details: FieldIssue[] = []) {
    super(message);
    this.name = 'AppError';
    this.details = details;
  }

  /** The message for a given form field, if one was flagged. */
  fieldError(field: string): string | undefined {
    return this.details.find((issue) => issue.field === field)?.message;
  }

  /** Builds an error from a list of field problems, using the first as the summary. */
  static fields(details: FieldIssue[], fallback = 'Please check the highlighted fields.'): AppError {
    return new AppError(details[0]?.message ?? fallback, details);
  }

  static field(field: string, message: string): AppError {
    return new AppError(message, [{ field, message }]);
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** Turns anything thrown into a message safe to show a person. */
export function messageFor(error: unknown, fallback = 'Something went wrong.'): string {
  if (isAppError(error)) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
