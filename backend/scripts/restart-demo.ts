/**
 * Sets up a clean, filmable restart-survival scenario.
 *
 *   npm run demo:restart
 *
 * Schedules 6 emails through the normal path — 3 due in ~90s, 3 due in ~150s —
 * so there is a comfortable window to kill the worker (and optionally wipe
 * Redis) on camera before anything fires.
 *
 * Suggested take:
 *   1. npm run demo:restart          # schedule, show the table
 *   2. npm run worker                # watch it boot and idle
 *   3. Ctrl+C                        # kill it mid-wait
 *   4. (optional, the strong demo)
 *      docker exec reachinbox-redis redis-cli EVAL \
 *        "local k=redis.call('keys','reachinbox:*') for i=1,#k do redis.call('del',k[i]) end return #k" 0
 *   5. npm run worker                # reconciliation repairs everything
 *   6. wait  -> all 6 still send, at their original times
 *
 * Flags:
 *   --keep      do not clear prior demo data first
 *   --count N   total emails (default 6, split evenly across the two waves)
 */
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

import { addEmailJob, closeEmailQueue, getQueueCounts } from '../src/queue/email.queue.js';
import { invalidateSenderCache, pickSenderForCampaign } from '../src/services/sender.service.js';

const prisma = new PrismaClient();

const DEMO_GOOGLE_ID = 'dev-local-restart-demo';
const WAVE_ONE_SECONDS = 90;
const WAVE_TWO_SECONDS = 150;

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}
const count = Number.parseInt(arg('count', '6'), 10);
const keep = process.argv.includes('--keep');

const idempotencyKeyFor = (campaignId: string, email: string, sequence: number) =>
  createHash('sha256').update(`${campaignId}${email}${sequence}`).digest('hex');

async function main() {
  invalidateSenderCache();

  const user = await prisma.user.upsert({
    where: { googleId: DEMO_GOOGLE_ID },
    create: { googleId: DEMO_GOOGLE_ID, email: 'restart.demo@local.test', name: 'Restart Demo' },
    update: {},
  });

  // ------------------------------------------------------------- clean slate
  if (!keep) {
    const old = await prisma.campaign.findMany({ where: { userId: user.id }, select: { id: true } });
    const ids = old.map((c) => c.id);

    if (ids.length > 0) {
      // Drop any queue entries still pointing at rows we are about to delete,
      // so the next boot's reconciliation starts from a genuinely clean state.
      const rows = await prisma.emailJob.findMany({
        where: { campaignId: { in: ids } },
        select: { bullJobId: true, idempotencyKey: true },
      });
      for (const r of rows) {
        for (const jobId of new Set([r.bullJobId, r.idempotencyKey].filter(Boolean) as string[])) {
          const job = await (await import('../src/queue/email.queue.js')).emailQueue.getJob(jobId);
          await job?.remove().catch(() => undefined);
        }
      }
      const del = await prisma.emailJob.deleteMany({ where: { campaignId: { in: ids } } });
      await prisma.campaign.deleteMany({ where: { id: { in: ids } } });
      console.log(`cleared prior demo data: ${del.count} email job(s), ${ids.length} campaign(s)`);
    }
  }

  const sender = await pickSenderForCampaign('bootstrap', 0);
  const now = Date.now();
  const firstWave = Math.ceil(count / 2);

  const campaign = await prisma.campaign.create({
    data: {
      userId: user.id,
      senderId: sender.id,
      subject: 'Restart survival demo',
      bodyHtml:
        '<div style="font-family:system-ui,sans-serif">' +
        '<h2>Restart survival demo</h2>' +
        '<p><strong>This email was scheduled before the server was killed.</strong></p>' +
        '<p>It still arrived, at its original time. ' +
        '<a href="https://ethereal.email">ethereal.email</a></p>' +
        '</div>',
      startTime: new Date(now + WAVE_ONE_SECONDS * 1000),
      delayBetweenMs: 0,
      hourlyLimit: 100,
      totalRecipients: count,
      status: 'SCHEDULED',
    },
  });

  const table: Record<string, string | number>[] = [];

  for (let sequence = 0; sequence < count; sequence += 1) {
    const wave = sequence < firstWave ? 1 : 2;
    const dueInSeconds = wave === 1 ? WAVE_ONE_SECONDS : WAVE_TWO_SECONDS;
    const scheduledAt = new Date(now + dueInSeconds * 1000);

    const recipientEmail = `restart-demo-${sequence}@example.com`;
    const idempotencyKey = idempotencyKeyFor(campaign.id, recipientEmail, sequence);

    const row = await prisma.emailJob.create({
      data: {
        campaignId: campaign.id,
        userId: user.id,
        senderId: sender.id,
        recipientEmail,
        recipientName: `Restart Demo ${sequence}`,
        subject: campaign.subject,
        bodyHtml: campaign.bodyHtml,
        scheduledAt,
        status: 'SCHEDULED',
        idempotencyKey,
        bullJobId: idempotencyKey,
        sequence,
        maxAttempts: 3,
      },
    });

    await addEmailJob({
      data: { emailJobId: row.id, campaignId: campaign.id, idempotencyKey },
      delayMs: dueInSeconds * 1000,
      jobId: idempotencyKey,
    });

    table.push({
      seq: sequence,
      wave,
      to: recipientEmail,
      dueIn: `${dueInSeconds}s`,
      scheduledAt: scheduledAt.toISOString(),
      jobId: `${idempotencyKey.slice(0, 10)}…`,
    });
  }

  console.log(`\ncampaign: ${campaign.id}`);
  console.log(`sender:   ${sender.email}`);
  console.table(table);
  console.log('queue counts:', await getQueueCounts());

  console.log(`\nAll ${count} emails are SCHEDULED in Postgres and DELAYED in Redis.`);
  console.log('Kill the worker now — they will still send at the times above.\n');
  console.log(`CAMPAIGN_ID=${campaign.id}`);
}

main()
  .catch((err) => {
    console.error('restart-demo failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeEmailQueue();
    await prisma.$disconnect();
  });
