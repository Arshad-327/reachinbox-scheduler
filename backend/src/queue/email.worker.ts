import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';

import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { createLogger } from '../lib/logger.js';
import { sendEmail } from '../services/email.service.js';
import { tryConsume, refund } from '../services/rateLimit.service.js';
import { addEmailJob, EMAIL_QUEUE_NAME, type EmailJobData } from './email.queue.js';
import { createQueueConnection, QUEUE_PREFIX } from './connection.js';

const log = createLogger('email-worker');

/**
 * A job is considered stalled if it holds its lock this long without renewing.
 * The SMTP layer caps connect/greeting/socket at 10s each, so the realistic
 * worst case for one send is well under 30s; 60s leaves comfortable headroom
 * and avoids a slow-but-healthy send being handed to a second worker.
 */
const LOCK_DURATION_MS = 60_000;

/** Statuses a job may be claimed FROM. Anything else means someone got there first. */
const CLAIMABLE = ['SCHEDULED', 'QUEUED'] as const;

/**
 * Per-sequence stagger applied when a batch spills into the next hour window.
 *
 * ORDERING: without this, every deferred job would be re-delayed by the exact
 * same amount and they would all become due in the same millisecond — a
 * thundering herd at the top of the hour, arriving in whatever order Redis
 * happens to pop them. Offsetting by (sequence * 50ms) makes lower sequence
 * numbers due first, so a spill group comes back in ascending sequence order.
 *
 * HONEST LIMITATION: this is approximate, not a FIFO guarantee. Two jobs 50ms
 * apart can still be reordered by worker scheduling, and past
 * MAX_JITTER_MS the offsets are clamped, so very large campaigns lose the
 * ordering property in their tail. Strict ordering would need a single
 * sequential consumer per campaign, which would cost all the parallelism.
 */
const JITTER_PER_SEQUENCE_MS = 50;
const MAX_JITTER_MS = 300_000;

/**
 * A campaign is done once nothing is left in a non-terminal state. Called after
 * a job reaches SENT *or* FAILED — if only successes counted, a campaign whose
 * final email hard-bounces would sit in RUNNING forever.
 */
async function maybeCompleteCampaign(campaignId: string): Promise<void> {
  const remaining = await prisma.emailJob.count({
    where: { campaignId, status: { in: ['SCHEDULED', 'QUEUED', 'PROCESSING'] } },
  });

  if (remaining > 0) {
    return;
  }

  const { count } = await prisma.campaign.updateMany({
    where: { id: campaignId, status: { in: ['SCHEDULED', 'RUNNING'] } },
    data: { status: 'COMPLETED' },
  });

  if (count > 0) {
    log.info({ campaignId }, 'campaign complete — all jobs terminal');
  }
}

export async function processEmailJob(job: Job<EmailJobData>): Promise<void> {
  const { emailJobId } = job.data;

  // ---------------------------------------------------------------- 1. load
  // Content is read from Postgres, never from the Redis payload, so the job
  // always sends what the campaign says RIGHT NOW.
  const row = await prisma.emailJob.findUnique({
    where: { id: emailJobId },
    include: { sender: true, campaign: true },
  });

  if (!row) {
    // The row was deleted (campaign purged) while the job sat in Redis. There
    // is nothing to send and nothing to fix, so do NOT throw — throwing would
    // burn retries and park it in the failed set for no reason.
    log.warn({ emailJobId, bullJobId: job.id }, 'EmailJob row not found — dropping job');
    return;
  }

  // ------------------------------------------------- 2. HOURLY RATE LIMIT
  //
  // Deliberately BEFORE the claim: a rate-limited job must not be marked
  // PROCESSING and must not increment `attempts`. Hitting the hourly cap is a
  // scheduling outcome, not a failure, so it can never exhaust a job's retry
  // budget no matter how many windows it waits through.
  const admission = await tryConsume(row.senderId);

  if (!admission.allowed) {
    // Do NOT throw, do NOT fail, do NOT drop — re-schedule into the next
    // window. Jitter by sequence so the spill group returns in order rather
    // than as a thundering herd at the top of the hour.
    const jitterMs = Math.min(row.sequence * JITTER_PER_SEQUENCE_MS, MAX_JITTER_MS);
    const delayMs = admission.retryAfterMs + jitterMs;
    const newScheduledAt = new Date(Date.now() + delayMs);

    // A BullMQ job id is only reusable once the old job is gone, and THIS job
    // is active right now — re-adding `idempotencyKey` would silently collide
    // with the very job we are inside, create nothing, and lose the email. So
    // each deferral mints a child id from a monotonic deferral counter carried
    // in the job payload.
    //
    // Why a counter and not the target hour: an hour-derived id collides with
    // itself if a delayed job ever fires a moment BEFORE its target window
    // opens (timer skew at the boundary), because it would then compute the
    // window it is already named after. The counter strictly increases, so a
    // child id can never equal its parent's regardless of clock behaviour.
    //
    // Still deterministic, so it keeps dedupe layer 1: two concurrent
    // processors deferring the same job both compute the same next counter and
    // therefore the same id, collapsing into one queued entry.
    // ('-' not ':' — BullMQ reserves ':' in custom ids.)
    const deferrals = (job.data.deferrals ?? 0) + 1;
    const retryJobId = `${row.idempotencyKey}-d${deferrals}`;

    await addEmailJob({
      data: {
        emailJobId: row.id,
        campaignId: row.campaignId,
        idempotencyKey: row.idempotencyKey,
        deferrals,
      },
      delayMs,
      jobId: retryJobId,
    });

    await prisma.emailJob.update({
      where: { id: emailJobId },
      // Status stays SCHEDULED and attempts is untouched: from the dashboard's
      // point of view this email is simply scheduled for later.
      data: { scheduledAt: newScheduledAt, bullJobId: retryJobId },
    });

    log.info(
      {
        emailJobId,
        blockedBy: admission.blockedBy,
        retryAfterMs: admission.retryAfterMs,
        jitterMs,
        newScheduledAt: newScheduledAt.toISOString(),
        deferrals,
        retryJobId,
      },
      'rate limited — deferred to next window',
    );

    return;
  }

  // ---------------------------------------------------- 3. IDEMPOTENCY GUARD
  //
  // This is the second and decisive idempotency layer, and the reason multiple
  // workers can safely share this queue.
  //
  // The claim is a single conditional UPDATE: flip SCHEDULED/QUEUED ->
  // PROCESSING and bump attempts, but ONLY if the row is still in a claimable
  // state. Postgres serialises concurrent updates to the same row, so of N
  // workers racing on one job exactly one sees count === 1; every other one
  // sees count === 0 because the status no longer matches the WHERE clause.
  //
  // Checking the status with a SELECT and then updating would be a classic
  // read-modify-write race — two workers could both read SCHEDULED and both
  // send. Doing the test and the write in ONE statement is what closes it.
  //
  // count === 0 also covers the benign case: the job already reached SENT and
  // is being redelivered (a stalled-lock recovery, or a duplicate enqueue that
  // slipped past layer 1). Either way: return without sending.
  const claim = await prisma.emailJob.updateMany({
    where: { id: emailJobId, status: { in: [...CLAIMABLE] } },
    data: { status: 'PROCESSING', lockedAt: new Date(), attempts: { increment: 1 } },
  });

  if (claim.count === 0) {
    // We reserved a rate-limit slot a moment ago but are not going to send,
    // and SMTP was never contacted — so give the slot back. This is the one
    // situation where a refund is provably correct.
    await refund(row.senderId);

    log.info(
      { emailJobId, bullJobId: job.id, currentStatus: row.status },
      'job already claimed or terminal — skipping send (idempotency guard), rate limit slot refunded',
    );
    return;
  }

  // We hold the claim, so we are the only writer: the increment above was ours
  // and this is the authoritative attempt number.
  const attemptNo = row.attempts + 1;

  // --------------------------------------------------------------- 4. send
  // sender comes from the row's PERSISTED senderId, chosen once at schedule
  // time. The worker never re-runs the round-robin, so every retry of this job
  // goes out through the same account as the first attempt.
  const result = await sendEmail({
    sender: row.sender,
    to: row.recipientEmail,
    ...(row.recipientName ? { toName: row.recipientName } : {}),
    subject: row.subject,
    bodyHtml: row.bodyHtml,
    idempotencyKey: row.idempotencyKey,
  });

  // ------------------------------------------------------------ 5. success
  if (result.ok) {
    await prisma.emailJob.update({
      where: { id: emailJobId },
      data: {
        status: 'SENT',
        sentAt: result.acceptedAt,
        messageId: result.messageId,
        previewUrl: result.previewUrl,
        lastError: null,
      },
    });

    log.info(
      { emailJobId, bullJobId: job.id, attemptNo, previewUrl: result.previewUrl },
      'email job sent',
    );

    await maybeCompleteCampaign(row.campaignId);
    return;
  }

  // --------------------------------------------------- 6. retryable failure
  if (result.isRetryable && attemptNo < row.maxAttempts) {
    // Back to SCHEDULED so the next attempt's claim can succeed, then THROW:
    // BullMQ owns the retry schedule (exponential backoff), not us.
    await prisma.emailJob.update({
      where: { id: emailJobId },
      data: { status: 'SCHEDULED', lastError: result.error },
    });

    log.warn(
      {
        emailJobId,
        bullJobId: job.id,
        attemptNo,
        maxAttempts: row.maxAttempts,
        code: result.code,
      },
      'email send failed, retryable — throwing for BullMQ backoff',
    );

    throw new Error(`Retryable send failure (attempt ${attemptNo}): ${result.error}`);
  }

  // ---------------------------------------------------- 7. terminal failure
  // Either permanent (EAUTH, 5xx, bad envelope) or out of attempts. Returning
  // normally marks the BullMQ job completed — the send is over, and retrying a
  // 535 or a 550 would fail identically every time.
  await prisma.emailJob.update({
    where: { id: emailJobId },
    data: { status: 'FAILED', lastError: result.error },
  });

  log.warn(
    {
      emailJobId,
      bullJobId: job.id,
      attemptNo,
      maxAttempts: row.maxAttempts,
      code: result.code,
      isRetryable: result.isRetryable,
      reason: result.isRetryable ? 'attempts exhausted' : 'permanent failure',
    },
    'email job failed terminally',
  );

  await maybeCompleteCampaign(row.campaignId);
}

export interface EmailWorkerHandle {
  worker: Worker<EmailJobData>;
  connection: Redis;
}

/**
 * RATE LIMITING / SPACING — worth understanding before changing either number.
 *
 * `limiter: { max: 1, duration: MIN_DELAY_BETWEEN_EMAILS_MS }` means BullMQ
 * STARTS at most one job per interval, queue-wide (the limiter state lives in
 * Redis, so it holds across multiple worker processes, not just this one).
 *
 * That is deliberately a limit on STARTS, not on overlap. With concurrency N,
 * up to N sends can still be in flight simultaneously — a slow 8s SMTP
 * handshake does not stop the next job starting 2s later. What is guaranteed
 * is the SPACING BETWEEN SEND STARTS, which is exactly what "minimum 2 seconds
 * between emails" asks for.
 *
 * Consequence worth stating plainly: concurrency mainly buys tolerance for slow
 * sends. Raising it does NOT raise throughput, because throughput is pinned at
 * 1/duration by the limiter. To send faster, lower MIN_DELAY_BETWEEN_EMAILS_MS.
 */
export function createEmailWorker(): EmailWorkerHandle {
  const connection = createQueueConnection();

  const worker = new Worker<EmailJobData>(EMAIL_QUEUE_NAME, processEmailJob, {
    connection,
    prefix: QUEUE_PREFIX,
    concurrency: env.WORKER_CONCURRENCY,
    limiter: { max: 1, duration: env.MIN_DELAY_BETWEEN_EMAILS_MS },
    lockDuration: LOCK_DURATION_MS,
  });

  worker.on('completed', (job) => {
    log.info({ emailJobId: job.data.emailJobId, bullJobId: job.id }, 'bull job completed');
  });

  worker.on('failed', (job, err) => {
    log.warn(
      {
        emailJobId: job?.data.emailJobId,
        bullJobId: job?.id,
        attemptsMade: job?.attemptsMade,
        err: err.message,
      },
      'bull job failed',
    );
  });

  // Worker-level fault (Redis dropped, processor blew up) — not a single job.
  worker.on('error', (err) => {
    log.error({ err }, 'worker error');
  });

  worker.on('stalled', (jobId) => {
    // A job held its lock past lockDuration without renewing: the process died
    // mid-send, or something blocked the event loop for a full minute. Loud on
    // purpose — the job is about to be redelivered, and the claim guard is the
    // only thing standing between that and a duplicate email.
    log.error(
      { bullJobId: jobId, lockDurationMs: LOCK_DURATION_MS },
      'JOB STALLED — lock expired, job will be redelivered',
    );
  });

  return { worker, connection };
}
