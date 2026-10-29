import type { Context } from 'hono';
import { ZodError } from 'zod';
import type { ErrorBody } from '@ledgora/contracts';

type Code = ErrorBody['error']['code'];

const STATUS: Record<Code, number> = {
  bad_request: 400,
  validation_failed: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  duplicate_number: 409,
  credit_dependency: 409,
  already_cancelled: 409,
  not_in_trash: 404,
  unprocessable: 422,
  too_many_requests: 429,
  internal: 500,
};

/** An error the client can act on. `code` is stable; `message` is for people. */
export class AppError extends Error {
  readonly code: Code;
  readonly status: number;
  readonly details?: unknown;
  constructor(code: Code, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export const notFound = (what: string) => new AppError('not_found', `${what} not found`);

export function validationError(err: ZodError) {
  return new AppError(
    'validation_failed',
    'The request is not valid',
    err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  );
}

/** Postgres errors worth a precise answer instead of a 500. */
function fromPostgres(err: unknown): AppError | null {
  const e = err as { code?: string; constraint_name?: string; cause?: unknown };
  const pg = (e?.cause ?? e) as { code?: string; constraint_name?: string };
  if (pg?.code === '23505') {
    if (pg.constraint_name === 'invoices_live_number') {
      return new AppError('duplicate_number', 'An invoice with this number already exists');
    }
    return new AppError('conflict', 'This record already exists', {
      constraint: pg.constraint_name,
    });
  }
  if (pg?.code === '23503') {
    return new AppError('conflict', 'This record is still used by another record', {
      constraint: pg.constraint_name,
    });
  }
  if (pg?.code === '22P02') return new AppError('bad_request', 'A value has the wrong format');
  return null;
}

export function errorHandler(err: unknown, c: Context) {
  const known =
    err instanceof AppError
      ? err
      : err instanceof ZodError
        ? validationError(err)
        : fromPostgres(err);
  if (known) {
    const body: ErrorBody = {
      error: { code: known.code, message: known.message, details: known.details },
    };
    return c.json(body, known.status as 400);
  }
  console.error('[api] unhandled error', err);
  const body: ErrorBody = {
    error: { code: 'internal', message: 'Something went wrong on our side' },
  };
  return c.json(body, 500);
}

export function notFoundHandler(c: Context) {
  const body: ErrorBody = {
    error: { code: 'not_found', message: `No such endpoint: ${c.req.method} ${c.req.path}` },
  };
  return c.json(body, 404);
}
