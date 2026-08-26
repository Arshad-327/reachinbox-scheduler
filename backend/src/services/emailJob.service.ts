import type { EmailJob, EmailStatus, Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma.js';
import type { EmailJobDTO, PaginatedResponse } from '../types/index.js';
import type { EmailListQuery } from '../schemas/index.js';

/** The two dashboard views. */
export type EmailView = 'scheduled' | 'sent';

/** What each view shows by default, and how it is ordered. */
const VIEW_STATUSES: Record<EmailView, EmailStatus[]> = {
  scheduled: ['SCHEDULED', 'QUEUED', 'PROCESSING'],
  // FAILED sits in the 'sent' view because both are terminal outcomes the user
  // reviews after the fact — "what happened to my emails", not "what is coming".
  sent: ['SENT', 'FAILED'],
};

export function toEmailJobDTO(row: EmailJob): EmailJobDTO {
  return {
    id: row.id,
    campaignId: row.campaignId,
    senderId: row.senderId,
    recipientEmail: row.recipientEmail,
    recipientName: row.recipientName,
    subject: row.subject,
    status: row.status,
    scheduledAt: row.scheduledAt.toISOString(),
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
    sequence: row.sequence,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    messageId: row.messageId,
    // The dashboard links straight to the Ethereal preview.
    previewUrl: row.previewUrl,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listEmailJobs(
  userId: string,
  view: EmailView,
  query: EmailListQuery,
): Promise<PaginatedResponse<EmailJobDTO>> {
  const { page, limit, campaignId, search, status } = query;

  // An explicit ?status= narrows the view rather than escaping it: a status
  // outside this view's set yields nothing, so /emails/sent can never leak a
  // still-scheduled row.
  const viewStatuses = VIEW_STATUSES[view];
  const statuses = status ? status.filter((s) => viewStatuses.includes(s)) : viewStatuses;

  const where: Prisma.EmailJobWhereInput = {
    // Ownership is a WHERE clause on every single query. There is no code path
    // that reads an EmailJob without it.
    userId,
    status: { in: statuses },
    ...(campaignId ? { campaignId } : {}),
    ...(search
      ? {
          OR: [
            { recipientEmail: { contains: search, mode: 'insensitive' } },
            { subject: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const orderBy: Prisma.EmailJobOrderByWithRelationInput[] =
    view === 'scheduled'
      ? // Next to go out, first.
        [{ scheduledAt: 'asc' }, { sequence: 'asc' }]
      : // Most recently sent, first. FAILED rows have a null sentAt, so fall
        // back to updatedAt to keep them in a sensible place rather than
        // stranded at one end.
        [{ sentAt: 'desc' }, { updatedAt: 'desc' }];

  const [total, rows] = await Promise.all([
    prisma.emailJob.count({ where }),
    prisma.emailJob.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    data: rows.map(toEmailJobDTO),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 0,
  };
}

export interface EmailStats {
  /** Per-status totals for this user. */
  byStatus: Record<EmailStatus, number>;
  /** Badge counts the sidebar shows next to "Scheduled" and "Sent". */
  scheduled: number;
  sent: number;
  total: number;
  campaigns: number;
}

export async function getStats(userId: string): Promise<EmailStats> {
  const [grouped, campaigns] = await Promise.all([
    prisma.emailJob.groupBy({ by: ['status'], where: { userId }, _count: true }),
    prisma.campaign.count({ where: { userId } }),
  ]);

  const byStatus: Record<EmailStatus, number> = {
    SCHEDULED: 0,
    QUEUED: 0,
    PROCESSING: 0,
    SENT: 0,
    FAILED: 0,
    CANCELLED: 0,
  };

  for (const row of grouped) {
    byStatus[row.status] = row._count;
  }

  const scheduled = VIEW_STATUSES.scheduled.reduce((n, s) => n + byStatus[s], 0);
  const sent = VIEW_STATUSES.sent.reduce((n, s) => n + byStatus[s], 0);

  return {
    byStatus,
    scheduled,
    sent,
    total: Object.values(byStatus).reduce((a, b) => a + b, 0),
    campaigns,
  };
}
