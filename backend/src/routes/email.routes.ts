import { Router } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { emailListQuerySchema } from '../schemas/index.js';
import type { EmailListQuery } from '../schemas/index.js';
import { getStats, listEmailJobs } from '../services/emailJob.service.js';

export const emailRouter = Router();

emailRouter.use(requireAuth);

/** Upcoming work: SCHEDULED / QUEUED / PROCESSING, soonest first. */
emailRouter.get('/scheduled', validate({ query: emailListQuerySchema }), async (req, res) => {
  const query = req.validated.query as EmailListQuery;
  res.json(await listEmailJobs(req.user!.id, 'scheduled', query));
});

/** History: SENT / FAILED, most recent first, with previewUrl for the demo link. */
emailRouter.get('/sent', validate({ query: emailListQuerySchema }), async (req, res) => {
  const query = req.validated.query as EmailListQuery;
  res.json(await listEmailJobs(req.user!.id, 'sent', query));
});

/** Sidebar badge counts. */
emailRouter.get('/stats', async (req, res) => {
  res.json(await getStats(req.user!.id));
});
