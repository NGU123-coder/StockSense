import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError, z } from 'zod';
import { HttpError } from '../utils/httpError';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
};

/** Pulls the Postgres error out of a driver error (Drizzle wraps the original in `cause`). */
function pgError(err: unknown): { code?: string; detail?: string; constraint?: string } | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  if (typeof e?.code === 'string' && /^\d{5}$/.test(e.code)) return e as never;
  if (typeof e?.cause?.code === 'string') return e.cause as never;
  return undefined;
}

// Express 5 forwards rejected promises from async handlers here automatically.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Validation failed', details: z.flattenError(err).fieldErrors });
    return;
  }
  const pg = pgError(err);
  if (pg?.code === '23505') {
    res.status(409).json({ error: 'A record with this value already exists', details: pg.detail });
    return;
  }
  if (pg?.code === '23514' && pg.constraint === 'stock_levels_quantity_non_negative') {
    res.status(409).json({ error: 'Not enough stock for this operation' });
    return;
  }
  if (pg?.code === '23503') {
    res.status(409).json({ error: 'This record is referenced by other data', details: pg.detail });
    return;
  }
  if (pg?.code === '22P02') {
    res.status(400).json({ error: 'Invalid identifier format' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side' });
};
