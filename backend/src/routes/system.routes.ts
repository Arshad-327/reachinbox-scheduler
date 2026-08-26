import { Router } from 'express';

import { env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { getActiveSenders } from '../services/sender.service.js';
import { peek } from '../services/rateLimit.service.js';

export const systemRouter = Router();

systemRouter.use(requireAuth);

/**
 * Live rate-limit state: the configured caps plus the actual Redis counters
 * for each active sender, and when the current window rolls over.
 *
 * Cheap to build because peek() already exists and is read-only — it never
 * mutates a counter, so polling this endpoint cannot consume anyone's quota.
 */
systemRouter.get('/limits', async (_req, res) => {
  const senders = await getActiveSenders();

  const perSender = await Promise.all(
    senders.map(async (sender) => {
      const view = await peek(sender.id);
      return {
        senderId: sender.id,
        email: sender.email,
        fromName: sender.fromName,
        // null means "inherit the env default" — surface which one applies.
        hourlyLimit: sender.hourlyLimit ?? env.MAX_EMAILS_PER_HOUR_PER_SENDER,
        limitSource: sender.hourlyLimit === null ? 'env-default' : 'sender-override',
        scopes: view.scopes,
      };
    }),
  );

  const first = senders[0] ? await peek(senders[0].id) : null;

  res.json({
    config: {
      strategy: env.RATE_LIMIT_STRATEGY,
      maxEmailsPerHourPerSender: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
      maxEmailsPerHourGlobal: env.MAX_EMAILS_PER_HOUR_GLOBAL,
      minDelayBetweenEmailsMs: env.MIN_DELAY_BETWEEN_EMAILS_MS,
      workerConcurrency: env.WORKER_CONCURRENCY,
      maxJobAttempts: env.MAX_JOB_ATTEMPTS,
    },
    window: {
      start: first?.windowStart ?? null,
      resetsInMs: first?.windowResetsInMs ?? null,
      resetsAt: first
        ? new Date(Date.now() + first.windowResetsInMs).toISOString()
        : null,
    },
    senders: perSender,
  });
});
