/**
 * End-to-end smoke test for the SMTP layer. No queue, no scheduling — just
 * proves the pool, the send path, the error classification and the sender
 * round-robin behave as designed.
 *
 *   npm run smoke:smtp
 *
 * Sends ONE real email through the first active sender to a fake recipient
 * (Ethereal is a catch-all, so nothing leaves the sandbox) and prints the
 * preview URL.
 */
import type { Sender } from '@prisma/client';
import { PrismaClient } from '@prisma/client';

import { sendEmail, classifySendError } from '../src/services/email.service.js';
import { smtpPool } from '../src/services/smtp.service.js';
import {
  getActiveSenders,
  getSenderById,
  invalidateSenderCache,
  pickSenderForCampaign,
} from '../src/services/sender.service.js';

const prisma = new PrismaClient();

const section = (n: number, title: string) =>
  console.log(`\n${'='.repeat(72)}\n[${n}] ${title}\n${'='.repeat(72)}`);

const check = (label: string, pass: boolean, detail = '') =>
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);

async function main() {
  invalidateSenderCache();

  // ---------------------------------------------------------------- verifyAll
  section(1, 'smtpPool.verifyAll() — every ACTIVE sender');
  const results = await smtpPool.verifyAll();
  console.table(results.map((r) => ({ senderId: r.senderId, email: r.email, ok: r.ok, error: r.error ?? '' })));
  check('all active senders authenticate', results.length > 0 && results.every((r) => r.ok));

  const active = await getActiveSenders();
  check('getActiveSenders() returns exactly 2', active.length === 2, `got ${active.length}`);

  // -------------------------------------------------------------- real send
  section(2, 'sendEmail() — one real message through sender[0]');
  const sender = active[0]!;
  const idempotencyKey = `smoke-${Date.now()}`;
  const bodyHtml = `
    <div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6">
      <h2>ReachInbox SMTP smoke test</h2>
      <p><strong>This line is bold.</strong> If you can read it, the HTML part rendered.</p>
      <p>And here is a link: <a href="https://ethereal.email">ethereal.email</a></p>
      <p>Idempotency key / Message-ID: <code>${idempotencyKey}</code></p>
    </div>`;

  const result = await sendEmail({
    sender,
    to: 'fake.recipient@example.com',
    toName: 'Fake Recipient',
    subject: `SMTP smoke test — ${idempotencyKey}`,
    bodyHtml,
    idempotencyKey,
  });

  console.log('  result:', JSON.stringify(result, null, 2));
  check('send succeeded', result.ok);
  if (result.ok) {
    console.log(`\n  >>> PREVIEW URL: ${result.previewUrl}\n`);
    check('previewUrl captured', result.previewUrl !== null);
    check('Message-ID derived from idempotencyKey',
      result.messageId === `<${idempotencyKey}@reachinbox.local>`, result.messageId);
  }

  // ------------------------------------------------------- transport caching
  section(3, 'getTransport() caches by sender id');
  const t1 = smtpPool.getTransport(sender);
  const t2 = smtpPool.getTransport(sender);
  check('same object reference returned twice', t1 === t2, `t1===t2 is ${t1 === t2}`);

  const other = active[1]!;
  const t3 = smtpPool.getTransport(other);
  check('a different sender gets a different transport', t1 !== t3);
  check('cache holds one transport per sender', smtpPool.size === 2, `size=${smtpPool.size}`);

  // ---------------------------------------------------- error classification
  section(4, 'Bad password → ok:false, EAUTH, isRetryable:false (DB untouched)');
  // Built in memory only. Never written, never read back — the real row keeps
  // its working password.
  const brokenSender: Sender = { ...sender, id: `${sender.id}-broken`, smtpPass: 'definitely-wrong-password' };

  const failed = await sendEmail({
    sender: brokenSender,
    to: 'fake.recipient@example.com',
    subject: 'This should never arrive',
    bodyHtml: '<p>nope</p>',
    idempotencyKey: `smoke-fail-${Date.now()}`,
  });

  console.log('  result:', JSON.stringify(failed, null, 2));
  check('did not throw, returned a value', typeof failed === 'object');
  check('ok === false', failed.ok === false);
  if (!failed.ok) {
    check('code === EAUTH', failed.code === 'EAUTH', String(failed.code));
    check('isRetryable === false', failed.isRetryable === false);
  }

  smtpPool.invalidate(brokenSender.id);
  const dbRow = await getSenderById(sender.id);
  check('DB row untouched (password still works)', dbRow?.smtpPass === sender.smtpPass);
  const stillOk = await smtpPool.getTransport(sender).verify().then(() => true).catch(() => false);
  check('real sender still verifies after the failure', stillOk);

  // ------------------------------------------------------------ round-robin
  section(5, 'pickSenderForCampaign() — deterministic round-robin over ACTIVE only');
  const campaignId = 'campaign-smoke-1';
  const picks: { sequence: number; senderId: string; email: string }[] = [];
  for (let sequence = 0; sequence <= 5; sequence += 1) {
    const picked = await pickSenderForCampaign(campaignId, sequence);
    picks.push({ sequence, senderId: picked.id, email: picked.email });
  }
  console.table(picks);

  const alternates = picks.every((p, i) => p.senderId === active[i % active.length]!.id);
  check('alternates across the 2 active senders', alternates);

  const a = await pickSenderForCampaign(campaignId, 3);
  const b = await pickSenderForCampaign(campaignId, 3);
  check('sequence 3 twice → same sender', a.id === b.id, `${a.email} === ${b.email}`);

  // The whole point: a rotated-out account must never take an email.
  const inactive = await prisma.sender.findMany({ where: { isActive: false } });
  const inactiveIds = new Set(inactive.map((s) => s.id));
  console.log(`  inactive senders in DB: ${inactive.map((s) => s.email).join(', ') || '(none)'}`);

  const wide: string[] = [];
  for (let sequence = 0; sequence < 100; sequence += 1) {
    wide.push((await pickSenderForCampaign(campaignId, sequence)).id);
  }
  const leaked = wide.filter((id) => inactiveIds.has(id));
  check('no deactivated sender picked across 100 sequences', leaked.length === 0,
    `${new Set(wide).size} distinct senders used, ${leaked.length} leaked`);

  console.log('\nDone.\n');
}

main()
  .catch((err) => {
    console.error('smoke-smtp failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    smtpPool.closeAll();
    await prisma.$disconnect();
  });
