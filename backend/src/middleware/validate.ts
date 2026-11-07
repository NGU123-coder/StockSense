import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

/**
 * Validates and parses req.body / req.query / req.params with Zod.
 * Parsed values are stored on res.locals so handlers get typed, coerced data.
 */
export const validate =
  (schemas: { body?: ZodType; query?: ZodType; params?: ZodType }): RequestHandler =>
  (req, res, next) => {
    if (schemas.body) req.body = schemas.body.parse(req.body);
    if (schemas.query) res.locals.query = schemas.query.parse(req.query);
    if (schemas.params) res.locals.params = schemas.params.parse(req.params);
    next();
  };
