/**
 * Seeds the Sender table from the SMTP_ACCOUNTS env var.
 *
 * Idempotent: keyed on Sender.email, so re-running updates the existing rows
 * instead of duplicating them. Does NOT create Users — those are created on
 * first Google login.
 *
 * Rotating credentials changes the Ethereal *addresses*, not just the
 * passwords, so the old rows would otherwise linger as active senders and
 * every round-robin pick that landed on one would fail with 535. Rather than
 * delete them — EmailJob.senderId is `onDelete: Restrict`, and past sends must
 * keep pointing at the account that actually sent them — anything no longer
 * present in SMTP_ACCOUNTS is flipped to isActive=false. Active senders are
 * the pick set; inactive ones stay for referential history.
 *
 * Run: npm run db:seed
 */
import { PrismaClient } from '@prisma/client';
import { env } from '../src/config/env.js';

const prisma = new PrismaClient();

async function main() {
  const accounts = env.SMTP_ACCOUNTS;

  if (accounts.length === 0) {
    console.warn('SMTP_ACCOUNTS is empty — refusing to deactivate every sender.');
    return;
  }

  const emails = accounts.map((a) => a.user);
  const existing = await prisma.sender.findMany({ select: { email: true } });
  const existingEmails = new Set(existing.map((s) => s.email));

  let created = 0;
  let updated = 0;

  for (const account of accounts) {
    await prisma.sender.upsert({
      where: { email: account.user },
      create: {
        email: account.user,
        fromName: account.fromName,
        smtpHost: account.host,
        smtpPort: account.port,
        smtpUser: account.user,
        smtpPass: account.pass,
      },
      // isActive is forced back on: an address that reappears in the env has
      // been re-provisioned and should rejoin the pool.
      update: {
        fromName: account.fromName,
        smtpHost: account.host,
        smtpPort: account.port,
        smtpUser: account.user,
        smtpPass: account.pass,
        isActive: true,
      },
    });

    if (existingEmails.has(account.user)) {
      updated += 1;
    } else {
      created += 1;
    }
  }

  const { count: deactivated } = await prisma.sender.updateMany({
    where: { email: { notIn: emails }, isActive: true },
    data: { isActive: false },
  });

  console.log(
    `Seed complete: ${created} created, ${updated} updated, ${deactivated} deactivated.`,
  );

  const all = await prisma.sender.findMany({ orderBy: { createdAt: 'asc' } });
  console.table(all.map((s) => ({ id: s.id, email: s.email, isActive: s.isActive })));
  console.log(`Sender rows: ${all.length} (${all.filter((s) => s.isActive).length} active)`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
