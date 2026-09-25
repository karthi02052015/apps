import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError, PG, pgErrorCode } from '../lib/errors';
import type { Logger } from '../lib/logger';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found.`, requestId: req.id } });
};

/** Final error boundary: clients get a stable shape and never see stack traces or SQL. */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const requestId = typeof req.id === 'string' ? req.id : undefined;
    let appErr: AppError;

    if (err instanceof AppError) appErr = err;
    else if (err instanceof ZodError) {
      appErr = AppError.badRequest(
        'Invalid request',
        err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    } else if (err?.type === 'entity.too.large') {
      appErr = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
    } else if (err?.type === 'entity.parse.failed') {
      appErr = new AppError(400, 'VALIDATION_ERROR', 'Request body is not valid JSON.');
    } else {
      const code = pgErrorCode(err);
      if (code === PG.UNIQUE_VIOLATION) appErr = AppError.conflict('That name is already in use.');
      else if (code === PG.FOREIGN_KEY_VIOLATION) appErr = AppError.badRequest('A referenced item does not exist.');
      else if (code === PG.INVALID_TEXT) appErr = AppError.notFound();
      else if (code === PG.INVALID_DATETIME || code === PG.DATETIME_OVERFLOW) appErr = AppError.badRequest('Invalid date value.');
      else if (code === PG.CHECK_VIOLATION) appErr = AppError.badRequest('The request violates a data constraint.');
      else {
        logger.error({ err, requestId, path: req.path }, 'unhandled error');
        appErr = new AppError(500, 'INTERNAL_ERROR', 'Something went wrong on our side. Please try again.');
      }
    }

    if (appErr.status >= 500 && err instanceof AppError) logger.error({ err, requestId }, 'server error');
    if (appErr.headers) res.set(appErr.headers);
    if (res.headersSent) return;
    res.status(appErr.status).json({
      error: {
        code: appErr.code,
        message: appErr.message,
        ...(appErr.details ? { details: appErr.details } : {}),
        ...(requestId ? { requestId } : {}),
      },
    });
  };
}
