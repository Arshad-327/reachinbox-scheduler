import { env } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { registerShutdownHandlers } from './lib/shutdown.js';
import { smtpPool } from './services/smtp.service.js';
import { createEmailWorker } from './queue/email.worker.js';
import { reconcileOnBoot, printReconciliationReport } from './services/reconciliation.service.js';
import { closeEmailQueue, getQueueCounts } from './queue/email.queue.js';

const log = createLogger('worker');

async function main(): Promise<void> {
  log.info(
    {
      concurrency: env.WORKER_CONCURRENCY,
      minDelayBetweenEmailsMs: env.MIN_DELAY_BETWEEN_EMAILS_MS,
      maxEmailsPerHourPerSender: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
      maxEmailsPerHourGlobal: env.MAX_EMAILS_PER_HOUR_GLOBAL,
      rateLimitStrategy: env.RATE_LIMIT_STRATEGY,
      maxJobAttempts: env.MAX_JOB_ATTEMPTS,
      redis: `${env.REDIS_HOST}:${env.REDIS_PORT}`,
    },
    'worker booting with resolved config',
  );

  // Fail loudly at boot rather than discovering a dead SMTP account on the
  // 500th email, halfway through a campaign, at 3am.
  const verified = await smtpPool.verifyAll();
  console.table(
    verified.map((v) => ({ senderId: v.senderId, email: v.email, ok: v.ok, error: v.error ?? '' })),
  );

  const usable = verified.filter((v) => v.ok);
  if (usable.length === 0) {
    log.fatal(
      { checked: verified.length },
      'No SMTP sender verified — refusing to start. Check SMTP_ACCOUNTS and run `npm run db:seed`.',
    );
    smtpPool.closeAll();
    await closeEmailQueue();
    process.exit(1);
  }

  if (usable.length < verified.length) {
    log.warn(
      { usable: usable.length, total: verified.length },
      'some senders failed verification — continuing with the rest',
    );
  }

  // ONE-SHOT reconciliation, after SMTP verification and BEFORE the worker
  // consumes anything: bringing the queue in line with the database while jobs
  // were already being processed would race with the repair itself.
  if (env.RECONCILE_ON_BOOT) {
    try {
      printReconciliationReport(await reconcileOnBoot());
    } catch (err) {
      // Starting a worker against an unreconciled queue silently loses email —
      // rows sit SCHEDULED with no job and nothing ever picks them up. Refuse.
      log.fatal({ err }, 'reconciliation failed — refusing to start with a possibly inconsistent queue');
      smtpPool.closeAll();
      await closeEmailQueue();
      process.exit(1);
    }
  } else {
    log.warn('RECONCILE_ON_BOOT=false — skipping boot reconciliation (orphaned rows will NOT be repaired)');
  }

  const { worker, connection } = createEmailWorker();
  log.info({ queue: worker.name, senders: usable.length }, 'email worker started');
  log.info(await getQueueCounts(), 'queue counts at boot');

  registerShutdownHandlers({
    name: 'worker',
    // worker.close() waits for in-flight jobs to finish before resolving, so a
    // Ctrl+C mid-send drains rather than killing the send and leaving the row
    // stuck in PROCESSING.
    cleanup: async () => {
      log.info('draining in-flight jobs (worker.close)');
      await worker.close();
      await connection.quit();
      await closeEmailQueue();
    },
  });
}

main().catch((err) => {
  log.fatal({ err }, 'worker failed to start');
  process.exit(1);
});
