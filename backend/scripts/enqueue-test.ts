/**
 * Creates a real campaign with N EmailJob rows and enqueues them as DELAYED
 * BullMQ jobs. No cron anywhere — the delay is the schedule.
 *
 *   npm run test:enqueue -- --count 5 --delay-seconds 5
 *   npm run test:enqueue -- --count 1 --delay-seconds 3 --bad-sender
 *
 * Flags:
 *   --count N           how many recipients (default 5)
 *   --delay-seconds S   delay before the first send (default 5)
 *   --bad-sender        route the jobs through a deliberately broken SMTP
 *                       account, to exercise the failure path
 *   --single-sender     pin every job to one sender instead of round-robin,
 *                       so a per-sender hourly cap can be exercised
 */
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

import { addEmailJob, closeEmailQueue, getQueueCounts } from '../src/queue/email.queue.js';
import { invalidateSenderCache, pickSenderForCampaign } from '../src/services/sender.service.js';

const prisma = new PrismaClient();

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

const count = Number.parseInt(arg('count', '5'), 10);
const delaySeconds = Number.parseInt(arg('delay-seconds', '5'), 10);
const badSender = hasFlag('bad-sender');
const singleSender = hasFlag('single-sender');

/**
 * sha256(campaignId + recipientEmail + sequence), per the schema. Hex output
 * matters: BullMQ uses ':' as its Redis key separator and rejects custom job
 * ids containing one, and this key IS the job id.
 */
function idempotencyKeyFor(campaignId: string, recipientEmail: string, sequence: number): string {
  return createHash('sha256').update(`${campaignId}${recipientEmail}${sequence}`).digest('hex');
}

async function main() {
  invalidateSenderCache();

  // ---------------------------------------------------------------- user
  const user = await prisma.user.upsert({
    where: { googleId: 'dev-local-enqueue-test' },
    create: {
      googleId: 'dev-local-enqueue-test',
      email: 'enqueue.test@local.test',
      name: 'Enqueue Test User',
    },
    update: {},
  });

  // -------------------------------------------------------------- sender
  // A broken sender is created inactive so it can never be picked by the
  // round-robin for normal campaigns — it is only reachable by explicit id.
  let forcedSenderId: string | null = null;
  if (badSender) {
    const broken = await prisma.sender.upsert({
      where: { email: 'broken.sender@ethereal.email' },
      create: {
        email: 'broken.sender@ethereal.email',
        fromName: 'Broken Sender',
        smtpHost: 'smtp.ethereal.email',
        smtpPort: 587,
        smtpUser: 'broken.sender@ethereal.email',
        smtpPass: 'deliberately-wrong-password',
        isActive: false,
      },
      update: { smtpPass: 'deliberately-wrong-password', isActive: false },
    });
    forcedSenderId = broken.id;
  }

  const campaignSender = forcedSenderId
    ? await prisma.sender.findUniqueOrThrow({ where: { id: forcedSenderId } })
    : await pickSenderForCampaign('bootstrap', 0);

  // ------------------------------------------------------------ campaign
  const startTime = new Date(Date.now() + delaySeconds * 1000);
  const campaign = await prisma.campaign.create({
    data: {
      userId: user.id,
      senderId: campaignSender.id,
      subject: `Queue test ${new Date().toISOString()}`,
      bodyHtml:
        '<div style="font-family:system-ui,sans-serif">' +
        '<h2>ReachInbox queue test</h2>' +
        '<p><strong>Delivered by the BullMQ worker.</strong></p>' +
        '<p><a href="https://ethereal.email">ethereal.email</a></p>' +
        '</div>',
      startTime,
      delayBetweenMs: 0,
      hourlyLimit: 100,
      totalRecipients: count,
      status: 'SCHEDULED',
    },
  });

  console.log(`campaign: ${campaign.id}`);
  console.log(`start:    ${startTime.toISOString()} (in ${delaySeconds}s)`);
  const senderMode = badSender
    ? `${campaignSender.email} (BROKEN, on purpose)`
    : singleSender
      ? `${campaignSender.email} (pinned, single-sender)`
      : 'round-robin';
  console.log(`sender:   ${senderMode}`);

  // ----------------------------------------------------------- email jobs
  const rows: { sequence: number; id: string; to: string; sender: string; jobId: string }[] = [];

  for (let sequence = 0; sequence < count; sequence += 1) {
    const recipientEmail = `recipient${sequence}@example.com`;
    const idempotencyKey = idempotencyKeyFor(campaign.id, recipientEmail, sequence);

    // THE KEY DECISION: the sender is resolved ONCE, here, at schedule time,
    // and persisted onto the row. The worker reads EmailJob.senderId and never
    // recomputes the round-robin — so a retry always goes out through the same
    // account as the first attempt, even if the active-sender set changes in
    // between (an operator rotating credentials mid-campaign).
    const sender =
      forcedSenderId || singleSender
        ? campaignSender
        : await pickSenderForCampaign(campaign.id, sequence);

    const row = await prisma.emailJob.create({
      data: {
        campaignId: campaign.id,
        userId: user.id,
        senderId: sender.id,
        recipientEmail,
        recipientName: `Recipient ${sequence}`,
        subject: campaign.subject,
        bodyHtml: campaign.bodyHtml,
        scheduledAt: startTime,
        status: 'SCHEDULED',
        idempotencyKey,
        bullJobId: idempotencyKey,
        sequence,
        maxAttempts: 3,
      },
    });

    await addEmailJob({
      data: { emailJobId: row.id, campaignId: campaign.id, idempotencyKey },
      delayMs: delaySeconds * 1000,
      jobId: idempotencyKey,
    });

    rows.push({
      sequence,
      id: row.id,
      to: recipientEmail,
      sender: sender.email,
      jobId: `${idempotencyKey.slice(0, 12)}…`,
    });
  }

  console.table(rows);
  console.log('queue counts:', await getQueueCounts());
  console.log(`\nCAMPAIGN_ID=${campaign.id}`);
}

main()
  .catch((err) => {
    console.error('enqueue-test failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeEmailQueue();
    await prisma.$disconnect();
  });
