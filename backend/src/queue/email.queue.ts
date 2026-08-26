import { Queue, type JobsOptions } from 'bullmq';

import { env } from '../config/env.js';
import { createLogger } from '../lib/logger.js';
import { createQueueConnection, QUEUE_PREFIX } from './connection.js';

const log = createLogger('queue');

export const EMAIL_QUEUE_NAME = 'email-send';

/**
 * The job payload carries IDs only — never the subject, body or recipient.
 *
 * Postgres stays the single source of truth: the worker re-reads the EmailJob
 * row at process time, so a job that has sat in Redis for six hours cannot
 * send stale content, and editing a campaign before it goes out actually takes
 * effect. It also keeps Redis small and makes the payload safe to log.
 */
export interface EmailJobData {
  /** DB row id — the only thing the worker really needs. */
  emailJobId: string;
  campaignId: string;
  idempotencyKey: string;
  /**
   * How many times this job has been deferred by the hourly rate limiter.
   * Absent on the first enqueue. Used to mint a collision-free child job id
   * for each deferral — see the rate-limit branch in email.worker.ts.
   */
  deferrals?: number;
}

const connection = createQueueConnection();

export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
  connection,
  prefix: QUEUE_PREFIX,
  defaultJobOptions: {
    attempts: env.MAX_JOB_ATTEMPTS,
    // Exponential from 5s: 5s, 10s, 20s. Spreads out a transient SMTP outage
    // instead of hammering it three times in a row.
    backoff: { type: 'exponential', delay: 5_000 },
    // Completed jobs are kept a day so the dashboard can show recent history,
    // then reaped. Failures are kept indefinitely — they are the interesting
    // ones and the dashboard needs to explain WHY something never arrived.
    removeOnComplete: { age: 86_400, count: 5_000 },
    removeOnFail: false,
  },
});

export interface AddEmailJobParams {
  data: EmailJobData;
  delayMs: number;
  /** Must equal the DB row's idempotencyKey. */
  jobId: string;
}

/**
 * Enqueues one delayed send.
 *
 * IDEMPOTENCY LAYER 1. `jobId` is the row's idempotencyKey, and BullMQ treats a
 * custom job id as unique: adding the same id twice does not create a second
 * job, it returns the existing one. So a retried API call, a double-submitted
 * form, or a reconciliation pass that re-adds everything on boot is a no-op
 * rather than a duplicate email.
 *
 * (Layer 2 is the conditional status claim in the worker, which covers the case
 * of two workers racing on the SAME job rather than the same job being added
 * twice.)
 */
export async function addEmailJob({ data, delayMs, jobId }: AddEmailJobParams) {
  // BullMQ reserves ':' as its Redis key separator and rejects it in custom
  // ids. Fail here with a message that names the culprit rather than letting
  // a bare 'Custom Id cannot contain :' surface from deep inside the library.
  if (jobId.includes(':')) {
    throw new Error(`Invalid jobId "${jobId}": BullMQ custom ids cannot contain ':'`);
  }

  const opts: JobsOptions = { jobId, delay: Math.max(0, delayMs) };
  const job = await emailQueue.add('send', data, opts);

  log.debug(
    { emailJobId: data.emailJobId, jobId, delayMs, bullJobId: job.id },
    'enqueued email job',
  );

  return job;
}

/** Used when a campaign is cancelled — a delayed job can simply be dropped. */
export async function removeEmailJob(jobId: string): Promise<boolean> {
  const job = await emailQueue.getJob(jobId);
  if (!job) {
    return false;
  }

  await job.remove();
  log.debug({ jobId }, 'removed email job');
  return true;
}

export async function getQueueCounts() {
  return emailQueue.getJobCounts(
    'waiting',
    'active',
    'delayed',
    'completed',
    'failed',
    'paused',
  );
}

/** Closes the queue and its dedicated Redis connection. */
export async function closeEmailQueue(): Promise<void> {
  await emailQueue.close();
  await connection.quit();
}
