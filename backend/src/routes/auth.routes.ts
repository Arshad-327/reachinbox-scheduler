import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { UnauthorizedError } from '../lib/errors.js';
import {
  issueJwt,
  toUserDTO,
  upsertUserFromGoogle,
  verifyGoogleIdToken,
} from '../services/auth.service.js';

export const authRouter = Router();

const googleAuthBody = z.object({
  idToken: z.string().min(1, 'idToken is required'),
});

/**
 * Exchange a Google ID token for our own session JWT.
 * Express 5 forwards async rejections to the error middleware — no try/catch.
 */
authRouter.post('/google', validate({ body: googleAuthBody }), async (req, res) => {
  const { idToken } = req.validated.body as z.infer<typeof googleAuthBody>;

  const profile = await verifyGoogleIdToken(idToken);
  const user = await upsertUserFromGoogle(profile);

  res.json({
    token: issueJwt(user),
    user: toUserDTO(user),
  });
});

/**
 * Current principal, re-read from the database rather than echoed from the
 * token, so a user deleted mid-session gets a 401 instead of stale claims.
 */
authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });

  if (!user) {
    throw new UnauthorizedError('User no longer exists');
  }

  res.json({ user: toUserDTO(user) });
});
