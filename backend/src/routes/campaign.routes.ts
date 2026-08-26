import { Router } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { idParamSchema, paginationSchema, scheduleCampaignSchema } from '../schemas/index.js';
import type { Pagination, ScheduleCampaignBody } from '../schemas/index.js';
import {
  cancelCampaign,
  createCampaign,
  getCampaign,
  listCampaigns,
} from '../services/campaign.service.js';

export const campaignRouter = Router();

// Every route here is behind auth; req.user is guaranteed below this line.
campaignRouter.use(requireAuth);

/** Schedule a campaign. Express 5 forwards async rejections — no try/catch. */
campaignRouter.post('/', validate({ body: scheduleCampaignSchema }), async (req, res) => {
  const body = req.validated.body as ScheduleCampaignBody;
  const result = await createCampaign(req.user!.id, body);

  res.status(201).json(result);
});

campaignRouter.get('/', validate({ query: paginationSchema }), async (req, res) => {
  const pagination = req.validated.query as Pagination;
  res.json(await listCampaigns(req.user!.id, pagination));
});

campaignRouter.get('/:id', validate({ params: idParamSchema }), async (req, res) => {
  const { id } = req.validated.params as { id: string };
  res.json(await getCampaign(req.user!.id, id));
});

campaignRouter.delete('/:id', validate({ params: idParamSchema }), async (req, res) => {
  const { id } = req.validated.params as { id: string };
  res.json(await cancelCampaign(req.user!.id, id));
});
