import { createHash } from 'node:crypto';
import type { Campaign, EmailStatus } from '@prisma/client';

import { prisma } from '../lib/prisma.js';
import { createLogger } from '../lib/logger.js';
import { BadRequestError, InternalError, NotFoundError } from '../lib/errors.js';
import { getActiveSenders, pickSenderForCampaign } from './sender.service.js';
import { addEmailJob, removeEmailJob } from '../queue/email.queue.js';
import type { CampaignDTO, CampaignJobCounts, PaginatedResponse } from '../types/index.js';
import type { Pagination, ScheduleCampaignBody } from '../schemas/index.js';

const log = createLogger('campaign');

/** Clock-skew grace: a startTime slightly in the past is fine, an old one is not. */
const START_TIME_GRACE_MS = 60_000;

const EMPTY_COUNTS: CampaignJobCounts = {
  SCHEDULED: 0,
  QUEUED: 0,
  PROCESSING: 0,
  SENT: 0,
  FAILED: 0,
  CANCELLED: 0,
};

/** sha256(campaignId : recipientEmail : sequence). Hex, so it is safe as a BullMQ job id. */
function idempotencyKeyFor(campaignId: string, recipientEmail: string, sequence: number): string {
  return createHash('sha256')
    .update(`${campaignId}:${recipientEmail}:${sequence}`)
    .digest('hex');
}

async function countsFor(campaignId: string): Promise<CampaignJobCounts> {
  const grouped = await prisma.emailJob.groupBy({
    by: ['status'],
    where: { campaignId },
    _count: true,
  });

  const counts: CampaignJobCounts = { ...EMPTY_COUNTS };
  for (const row of grouped) {
    counts[row.status] = row._count;
  }
  return counts;
}

export function toCampaignDTO(campaign: Campaign, counts: CampaignJobCounts): CampaignDTO {
  return {
    id: campaign.id,
    userId: campaign.userId,
    senderId: campaign.senderId,
    subject: campaign.subject,
    bodyHtml: campaign.bodyHtml,
    status: campaign.status,
    startTime: campaign.startTime.toISOString(),
    delayBetweenMs: campaign.delayBetweenMs,
    hourlyLimit: campaign.hourlyLimit,
    totalRecipients: campaign.totalRecipients,
    counts,
    createdAt: campaign.createdAt.toISOString(),
    updatedAt: campaign.updatedAt.toISOString(),
  };
}

export interface CreateCampaignResult {
  campaign: CampaignDTO;
  /** How many recipients were dropped as case-insensitive duplicates. */
  duplicatesDropped: number;
  enqueued: number;
}

/**
 * Case-insensitive, trimmed dedupe of the recipient list.
 *
 * EmailJob has a @@unique([campaignId, recipientEmail]); without this a single
 * repeated address would abort the whole createMany with a P2002 and lose the
 * entire campaign. Dedupe first, report what was dropped, and let the batch
 * succeed. First occurrence wins so the caller's ordering (and any name they
 * supplied first) is preserved.
 */
function dedupeRecipients(recipients: ScheduleCampaignBody['recipients']) {
  const seen = new Set<string>();
  const unique: { email: string; name?: string }[] = [];
  let duplicates = 0;

  for (const r of recipients) {
    const email = r.email.trim();
    const key = email.toLowerCase();

    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }

    seen.add(key);
    unique.push({ email, ...(r.name ? { name: r.name } : {}) });
  }

  return { unique, duplicates };
}

export async function createCampaign(
  userId: string,
  input: ScheduleCampaignBody,
): Promise<CreateCampaignResult> {
  // 1. Reject a start time that is genuinely in the past. A minute of grace
  //    absorbs clock skew between the browser and this server.
  if (input.startTime.getTime() < Date.now() - START_TIME_GRACE_MS) {
    throw new BadRequestError('startTime must not be more than 1 minute in the past', {
      startTime: input.startTime.toISOString(),
      now: new Date().toISOString(),
    });
  }

  // 2. No senders means nothing can ever go out — fail loudly rather than
  //    accepting a campaign that would silently never send.
  const senders = await getActiveSenders();
  if (senders.length === 0) {
    throw new InternalError('No active senders configured — seed the Sender table from SMTP_ACCOUNTS');
  }

  const { unique, duplicates } = dedupeRecipients(input.recipients);

  const created = await prisma.$transaction(
    async (tx) => {
      // 3. Campaign first: its id feeds every idempotency key below.
      const campaign = await tx.campaign.create({
        data: {
          userId,
          senderId: senders[0]!.id,
          subject: input.subject,
          bodyHtml: input.bodyHtml,
          startTime: input.startTime,
          delayBetweenMs: input.delayBetweenMs,
          hourlyLimit: input.hourlyLimit,
          totalRecipients: unique.length,
          status: 'SCHEDULED',
        },
      });

      // 4. One row per recipient, in order.
      const rows = [];
      for (let sequence = 0; sequence < unique.length; sequence += 1) {
        const recipient = unique[sequence]!;

        // The sender is resolved ONCE, here, and persisted. The worker reads
        // EmailJob.senderId and never recomputes the round-robin, so a retry
        // always uses the same account as the first attempt — even if the
        // active-sender set changes in between.
        const sender = await pickSenderForCampaign(campaign.id, sequence);

        rows.push({
          campaignId: campaign.id,
          userId,
          senderId: sender.id,
          recipientEmail: recipient.email,
          recipientName: recipient.name ?? null,
          subject: input.subject,
          bodyHtml: input.bodyHtml,
          scheduledAt: new Date(input.startTime.getTime() + sequence * input.delayBetweenMs),
          status: 'SCHEDULED' as EmailStatus,
          idempotencyKey: idempotencyKeyFor(campaign.id, recipient.email, sequence),
          bullJobId: idempotencyKeyFor(campaign.id, recipient.email, sequence),
          sequence,
          maxAttempts: 3,
        });
      }

      await tx.emailJob.createMany({ data: rows });

      return { campaign, rows };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );

  // 5. Enqueue AFTER the transaction commits — never inside it.
  //
  //    Inside the transaction we could enqueue jobs and then have the tx roll
  //    back, leaving BullMQ holding jobs that reference EmailJob rows which do
  //    not exist. The worker would wake up, fail to find the row, and the
  //    campaign would be half-real in Redis and absent from Postgres.
  //
  //    Doing it after inverts the failure mode: the worst case is committed
  //    rows with no queue entry. That state is benign and self-healing —
  //    boot reconciliation scans for exactly it and re-adds the missing jobs.
  //    The asymmetry is deliberate: prefer the failure that the system can
  //    repair over the one it cannot.
  //    createMany does not return the generated ids, so read them back in ONE
  //    query rather than looking each row up individually — at 5000 recipients
  //    the per-row version would be 5000 round-trips.
  const persisted = await prisma.emailJob.findMany({
    where: { campaignId: created.campaign.id },
    orderBy: { sequence: 'asc' },
    select: { id: true, idempotencyKey: true, scheduledAt: true },
  });

  let enqueued = 0;
  for (const row of persisted) {
    await addEmailJob({
      data: {
        emailJobId: row.id,
        campaignId: created.campaign.id,
        idempotencyKey: row.idempotencyKey,
      },
      delayMs: Math.max(0, row.scheduledAt.getTime() - Date.now()),
      jobId: row.idempotencyKey,
    });
    enqueued += 1;
  }

  log.info(
    {
      campaignId: created.campaign.id,
      userId,
      recipients: unique.length,
      duplicatesDropped: duplicates,
      enqueued,
    },
    'campaign scheduled',
  );

  return {
    campaign: toCampaignDTO(created.campaign, await countsFor(created.campaign.id)),
    duplicatesDropped: duplicates,
    enqueued,
  };
}

export async function listCampaigns(
  userId: string,
  { page, limit }: Pagination,
): Promise<PaginatedResponse<CampaignDTO>> {
  // Ownership is enforced in the WHERE clause, not after the fact.
  const where = { userId };

  const [total, campaigns] = await Promise.all([
    prisma.campaign.count({ where }),
    prisma.campaign.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  const data = await Promise.all(
    campaigns.map(async (c) => toCampaignDTO(c, await countsFor(c.id))),
  );

  return { data, page, limit, total, totalPages: Math.ceil(total / limit) || 0 };
}

export async function getCampaign(userId: string, campaignId: string): Promise<CampaignDTO> {
  // userId is part of the lookup: another user's id resolves to nothing, so
  // the response is a 404 rather than a 403. Never confirm that an id exists
  // to someone who does not own it.
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, userId } });

  if (!campaign) {
    throw new NotFoundError('Campaign not found');
  }

  return toCampaignDTO(campaign, await countsFor(campaign.id));
}

export interface CancelResult {
  campaignId: string;
  status: 'CANCELLED';
  jobsCancelled: number;
  queueEntriesRemoved: number;
  alreadyTerminal: number;
}

/** Non-terminal work only. Anything already SENT or FAILED is history. */
const CANCELLABLE: EmailStatus[] = ['SCHEDULED', 'QUEUED', 'PROCESSING'];

export async function cancelCampaign(userId: string, campaignId: string): Promise<CancelResult> {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, userId } });
  if (!campaign) {
    throw new NotFoundError('Campaign not found');
  }

  const pending = await prisma.emailJob.findMany({
    where: { campaignId, status: { in: CANCELLABLE } },
    select: { id: true, idempotencyKey: true, bullJobId: true },
  });

  const [{ count: jobsCancelled }] = await prisma.$transaction([
    prisma.emailJob.updateMany({
      where: { campaignId, status: { in: CANCELLABLE } },
      data: { status: 'CANCELLED' },
    }),
    prisma.campaign.update({ where: { id: campaignId }, data: { status: 'CANCELLED' } }),
  ]);

  // Drop the delayed jobs so the worker never wakes for them. Even if a
  // removal fails, the processor's claim guard rejects a CANCELLED row, so
  // the queue entry is inert either way — this just keeps Redis tidy.
  let queueEntriesRemoved = 0;
  for (const row of pending) {
    for (const jobId of new Set([row.bullJobId, row.idempotencyKey].filter(Boolean) as string[])) {
      if (await removeEmailJob(jobId)) {
        queueEntriesRemoved += 1;
      }
    }
  }

  const alreadyTerminal = await prisma.emailJob.count({
    where: { campaignId, status: { in: ['SENT', 'FAILED'] } },
  });

  log.info(
    { campaignId, userId, jobsCancelled, queueEntriesRemoved, alreadyTerminal },
    'campaign cancelled',
  );

  return { campaignId, status: 'CANCELLED', jobsCancelled, queueEntriesRemoved, alreadyTerminal };
}
