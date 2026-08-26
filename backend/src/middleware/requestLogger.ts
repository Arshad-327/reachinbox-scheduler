import type { NextFunction, Request, Response } from 'express';
import { logger } from '../lib/logger.js';

/**
 * One structured line per completed request, correlated by requestId.
 * Hand-rolled rather than pino-http so the correlation id stays owned by the
 * requestId middleware instead of being generated twice.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    logger[level](
      {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
      },
      `${req.method} ${req.originalUrl} ${res.statusCode}`,
    );
  });

  next();
}
