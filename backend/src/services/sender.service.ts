import type { Sender } from '@prisma/client';

import { prisma } from '../lib/prisma.js';
import { createLogger } from '../lib/logger.js';
import { InternalError } from '../lib/errors.js';

const log = createLogger('sender');

/**
 * Active senders change only when an operator rotates credentials, but they are
 * read on every single scheduled email, so a short TTL cache keeps the hot path
 * off the database without making a deactivation take effect only after a
 * restart.
 */
const CACHE_TTL_MS = 60_000;

let cache: { senders: Sender[]; expiresAt: number } | null = null;

/** Cached list of ACTIVE senders. Inactive rows are never returned. */
export async function getActiveSenders(): Promise<Sender[]> {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.senders;
  }

  const senders = await prisma.sender.findMany({
    where: { isActive: true },
    // Stable ordering is part of the round-robin contract below: if the row
    // order shifted between calls, the same sequence could map to a different
    // sender and break the determinism retries rely on.
    orderBy: { createdAt: 'asc' },
  });

  cache = { senders, expiresAt: Date.now() + CACHE_TTL_MS };
  log.debug({ count: senders.length }, 'refreshed active sender cache');

  return senders;
}

/** Drops the cache — call after seeding or toggling isActive. */
export function invalidateSenderCache(): void {
  cache = null;
}

export async function getSenderById(id: string): Promise<Sender | null> {
  return prisma.sender.findUnique({ where: { id } });
}

/**
 * Deterministic round-robin across ACTIVE senders.
 *
 * Determinism is the whole point: a job's sender is a pure function of its
 * sequence number, so a retry of sequence 7 always resolves to the same
 * account as the original attempt. If the mapping were random or stateful
 * (a rotating counter), a retried job could go out from a different sender
 * than the one that already half-delivered it, which breaks the idempotency
 * story — the Message-ID would collide across two different SMTP accounts.
 *
 * Deactivated senders are excluded because the pick set is getActiveSenders():
 * a rotated-out account would otherwise take every Nth email and fail it with
 * a 535.
 *
 * Note the trade-off: because the pick set is length-sensitive, deactivating a
 * sender re-maps the sequences of any campaign still in flight. That is
 * acceptable — an inactive sender cannot deliver anyway — but it does mean
 * determinism holds for a given active-sender set, not across a rotation.
 */
export async function pickSenderForCampaign(
  campaignId: string,
  sequence: number,
): Promise<Sender> {
  const senders = await getActiveSenders();

  if (senders.length === 0) {
    throw new InternalError(
      'No active senders configured — seed the Sender table from SMTP_ACCOUNTS',
    );
  }

  const sender = senders[sequence % senders.length]!;

  // trace, not debug: this fires once per email, so at debug it would bury
  // every other line in the worker's log during a large campaign.
  log.trace(
    { campaignId, sequence, senderId: sender.id, poolSize: senders.length },
    'picked sender for campaign job',
  );

  return sender;
}
