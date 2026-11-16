import { ZodError } from 'zod';
import AppError from '../utils/AppError.js';

export const notFound = (req, _res, next) =>
  next(new AppError(`Route ${req.method} ${req.originalUrl} not found`, 404, 'NOT_FOUND'));

/** Translates Postgres error codes into API errors (see master doc, layer rules). */
function fromPostgres(err) {
  switch (err.code) {
    case '23505':
      return new AppError('Resource already exists', 409, 'CONFLICT');
    case '23001': // restrict_violation (PostgreSQL 18+ reports ON DELETE RESTRICT here)
      return new AppError('Resource is still referenced and cannot be removed', 409, 'CONFLICT');
    case '23503':
      return new AppError('Referenced resource does not exist', 400, 'VALIDATION_ERROR');
    case '23514':
    case '22P02':
      return new AppError('Value rejected by data constraints', 400, 'VALIDATION_ERROR');
    case 'P0001':
      return new AppError('Operation not allowed on append-only data', 409, 'CONFLICT');
    default:
      return null;
  }
}

export function errorHandler(err, _req, res, _next) {
  let e = err;
  if (err instanceof ZodError) {
    e = new AppError(
      'Validation failed',
      400,
      'VALIDATION_ERROR',
      err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  } else if (err?.type === 'entity.parse.failed') {
    e = new AppError('Malformed JSON body', 400, 'VALIDATION_ERROR');
  } else if (typeof err?.code === 'string' && !(err instanceof AppError)) {
    e = fromPostgres(err) ?? err;
  }

  if (!(e instanceof AppError)) {
    console.error(err); // full stack stays on the server
    e = new AppError('Something went wrong', 500, 'INTERNAL');
  }
  res.status(e.statusCode).json({
    success: false,
    error: { code: e.code, message: e.message, details: e.details },
  });
}
