import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

import { env } from '../config/env.js';
import { UnauthorizedError } from '../lib/errors.js';
import type { AuthUser } from '../types/index.js';

interface JwtPayloadShape {
  sub: string;
  email: string;
  name: string;
}

function extractBearerToken(header: string | undefined): string {
  if (!header) {
    throw new UnauthorizedError('Missing Authorization header');
  }

  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) {
    throw new UnauthorizedError('Authorization header must be "Bearer <token>"');
  }

  return token;
}

/**
 * Verifies our own JWT (not Google's) and attaches the principal to req.user.
 * Distinct messages per failure mode so a client can tell "log in again" from
 * "your session expired".
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractBearerToken(req.get('authorization'));

  let payload: JwtPayloadShape;
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as JwtPayloadShape;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError('Token expired');
    }
    if (err instanceof jwt.NotBeforeError) {
      throw new UnauthorizedError('Token not yet valid');
    }
    if (err instanceof jwt.JsonWebTokenError) {
      throw new UnauthorizedError(`Invalid token: ${err.message}`);
    }
    throw new UnauthorizedError('Token verification failed');
  }

  if (!payload.sub || !payload.email) {
    throw new UnauthorizedError('Token payload is missing required claims');
  }

  const user: AuthUser = {
    id: payload.sub,
    email: payload.email,
    name: payload.name,
  };
  req.user = user;

  next();
}
