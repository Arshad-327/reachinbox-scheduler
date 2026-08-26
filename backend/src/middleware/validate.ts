import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';

export interface ZodSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/**
 * Validates the declared parts of a request and stashes the PARSED values on
 * `req.validated`.
 *
 * The parsed value is deliberately not written back over `req.query` /
 * `req.params`: Express 5 exposes `req.query` as a lazy getter with no setter,
 * so assigning to it throws. Read validated data from `req.validated` instead.
 *
 * Errors are thrown, not handled — ZodError is mapped to a 400
 * VALIDATION_ERROR by the error middleware.
 */
export function validate(schemas: ZodSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    req.validated ??= {};

    if (schemas.body) {
      req.validated.body = schemas.body.parse(req.body);
    }
    if (schemas.query) {
      req.validated.query = schemas.query.parse(req.query);
    }
    if (schemas.params) {
      req.validated.params = schemas.params.parse(req.params);
    }

    next();
  };
}
