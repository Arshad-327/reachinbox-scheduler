import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import type { User } from '@prisma/client';

import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { UnauthorizedError } from '../lib/errors.js';
import type { GoogleProfile, UserDTO } from '../types/index.js';

const TOKEN_TTL = '7d';

const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);

/**
 * Verifies a Google ID token minted for OUR client id against Google's public
 * keys. The backend never speaks to Google's authorize endpoint — the frontend
 * (NextAuth) does that and hands us the resulting ID token.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  let ticket;
  try {
    ticket = await googleClient.verifyIdToken({
      idToken,
      audience: env.GOOGLE_CLIENT_ID,
    });
  } catch (err) {
    throw new UnauthorizedError(
      `Google ID token verification failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const payload = ticket.getPayload();
  if (!payload) {
    throw new UnauthorizedError('Google ID token has no payload');
  }
  if (!payload.sub) {
    throw new UnauthorizedError('Google ID token is missing the "sub" claim');
  }
  if (!payload.email) {
    throw new UnauthorizedError('Google ID token is missing the "email" claim');
  }
  if (payload.email_verified !== true) {
    throw new UnauthorizedError('Google account email is not verified');
  }

  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name ?? payload.email,
    avatarUrl: payload.picture ?? null,
  };
}

/**
 * Upserts on googleId — the stable Google identifier. Name, avatar and email
 * are refreshed on every login so profile changes propagate.
 */
export async function upsertUserFromGoogle(profile: GoogleProfile): Promise<User> {
  return prisma.user.upsert({
    where: { googleId: profile.googleId },
    create: {
      googleId: profile.googleId,
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
    },
    update: {
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
    },
  });
}

/** Signs our own session JWT. `sub` is the User.id, not the Google id. */
export function issueJwt(user: Pick<User, 'id' | 'email' | 'name'>): string {
  const options: jwt.SignOptions = { expiresIn: TOKEN_TTL };

  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
    },
    env.JWT_SECRET,
    options,
  );
}

export function toUserDTO(user: User): UserDTO {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt.toISOString(),
  };
}
