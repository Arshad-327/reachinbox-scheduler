import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { isProd } from '../config/env.js';
import type { ApiErrorBody } from '../types/index.js';

/**
 * NOTE: there is deliberately no `asyncHandler` wrapper in this codebase.
 * Express 5 forwards a rejected promise from a route handler to this error
 * middleware on its own, so `router.get('/x', async (req, res) => ...)` is
 * safe as-is. Do not add try/catch or asyncHandler boilerplate around
 * handlers — it buys nothing and hides throw sites.
 */

/** Turns a ZodError into a { field: messages[] } map. */
function flattenZodError(err: ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of err.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_root';
    (fieldErrors[key] ??= []).push(issue.message);
  }

  return fieldErrors;
}

interface Resolved {
  statusCode: number;
  body: ApiErrorBody;
  /** Log the full stack — an unexpected failure rather than a known one. */
  unexpected: boolean;
}

function resolve(err: unknown): Resolved {
  if (err instanceof AppError) {
    return {
      statusCode: err.statusCode,
      body: {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details === undefined ? {} : { details: err.details }),
        },
      },
      unexpected: !err.isOperational,
    };
  }

  if (err instanceof ZodError) {
    return {
      statusCode: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: flattenZodError(err),
        },
      },
      unexpected: false,
    };
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = err.meta?.target;
      const fields = Array.isArray(target) ? target.join(', ') : String(target ?? 'unknown');
      return {
        statusCode: 409,
        body: {
          error: {
            code: 'CONFLICT',
            message: `A record with this ${fields} already exists`,
            details: { constraint: target ?? null },
          },
        },
        unexpected: false,
      };
    }

    if (err.code === 'P2025') {
      return {
        statusCode: 404,
        body: { error: { code: 'NOT_FOUND', message: 'Record not found' } },
        unexpected: false,
      };
    }
  }

  return {
    statusCode: 500,
    body: {
      error: {
        code: 'INTERNAL',
        // Never leak internals in production; in dev the real message is far
        // more useful than a placeholder.
        message: isProd
          ? 'Internal server error'
          : err instanceof Error
            ? err.message
            : String(err),
      },
    },
    unexpected: true,
  };
}

/** Express 5 error middleware. Must keep all four parameters to be recognised. */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const { statusCode, body, unexpected } = resolve(err);

  logger.error(
    {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode,
      code: body.error.code,
      // Only hand pino an `err` object for genuine faults. Operational
      // errors carry no useful stack, and the serializer would render an
      // empty one on every routine 400/401.
      ...(unexpected ? { err } : {}),
    },
    body.error.message,
  );

  if (res.headersSent) {
    return;
  }

  res.status(statusCode).json(body);
}

/** Terminal 404 for anything no router matched. */
export function notFoundHandler(req: Request, res: Response): void {
  const body: ApiErrorBody = {
    error: {
      code: 'NOT_FOUND',
      message: `Cannot ${req.method} ${req.originalUrl}`,
    },
  };

  logger.warn(
    { requestId: req.requestId, method: req.method, path: req.originalUrl, statusCode: 404 },
    body.error.message,
  );

  res.status(404).json(body);
}
