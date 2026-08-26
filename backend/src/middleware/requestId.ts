import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * Honours an inbound X-Request-Id so a trace can span frontend -> API ->
 * worker, and generates one otherwise. Echoed back on the response so callers
 * can quote it in a bug report.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get(REQUEST_ID_HEADER);
  const id = incoming && incoming.trim().length > 0 ? incoming.trim() : randomUUID();

  req.requestId = id;
  req.validated = {};
  res.setHeader(REQUEST_ID_HEADER, id);

  next();
}
