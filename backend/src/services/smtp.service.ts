import nodemailer from 'nodemailer';
import type { Sender } from '@prisma/client';

import { createLogger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';

const log = createLogger('smtp');

/**
 * A hung SMTP socket must never wedge a worker forever, so every phase of the
 * conversation gets its own ceiling: TCP connect, the server greeting, and any
 * subsequent read. Without socketTimeout in particular a half-open connection
 * can park a pooled worker slot indefinitely.
 */
const TIMEOUT_MS = 10_000;

/**
 * One pooled transport per Sender. nodemailer keeps up to `maxConnections`
 * sockets warm and recycles each after `maxMessages`, which both amortises the
 * TLS handshake and stops Ethereal throttling us for reconnect churn.
 */
function createPooledTransport(sender: Sender) {
  return nodemailer.createTransport({
    host: sender.smtpHost,
    port: sender.smtpPort,
    // 465 is implicit TLS; 587 (what Ethereal uses) upgrades via STARTTLS.
    secure: sender.smtpPort === 465,
    auth: { user: sender.smtpUser, pass: sender.smtpPass },
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });
}

/** The concrete pooled transporter type, taken from the factory so we never
 *  hand-write a nodemailer generic that could drift from the installed types. */
export type PooledTransporter = ReturnType<typeof createPooledTransport>;

export interface VerifyResult {
  senderId: string;
  email: string;
  ok: boolean;
  error?: string;
}

/**
 * Owns one nodemailer transport per sender, created lazily and cached.
 *
 * Building a transport per email would open a fresh TCP + TLS connection every
 * send; the cache is what makes `pool: true` mean anything, since a pool that
 * is discarded after one message is just an expensive single connection.
 */
class SmtpPool {
  private readonly transports = new Map<string, PooledTransporter>();

  /** Lazily creates and caches. Repeat calls return the identical instance. */
  getTransport(sender: Sender): PooledTransporter {
    const cached = this.transports.get(sender.id);
    if (cached) {
      return cached;
    }

    const transport = createPooledTransport(sender);
    this.transports.set(sender.id, transport);

    log.debug(
      { senderId: sender.id, email: sender.email, host: sender.smtpHost, port: sender.smtpPort },
      'created pooled SMTP transport',
    );

    return transport;
  }

  /**
   * Verifies every ACTIVE sender's credentials. Called at worker boot so a
   * dead SMTP account is loud immediately rather than surfacing on the 500th
   * email, halfway through a campaign.
   */
  async verifyAll(): Promise<VerifyResult[]> {
    const senders = await prisma.sender.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    return Promise.all(
      senders.map(async (sender): Promise<VerifyResult> => {
        try {
          await this.getTransport(sender).verify();
          log.info({ senderId: sender.id, email: sender.email }, 'SMTP verify ok');
          return { senderId: sender.id, email: sender.email, ok: true };
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          log.warn({ senderId: sender.id, email: sender.email, error }, 'SMTP verify failed');
          return { senderId: sender.id, email: sender.email, ok: false, error };
        }
      }),
    );
  }

  /** Drops one transport — use after rotating credentials or on hard auth failure. */
  invalidate(senderId: string): void {
    const transport = this.transports.get(senderId);
    if (!transport) {
      return;
    }

    transport.close();
    this.transports.delete(senderId);
    log.info({ senderId }, 'invalidated SMTP transport');
  }

  /** Closes every pooled connection. Wired into the graceful shutdown path. */
  closeAll(): void {
    const count = this.transports.size;
    for (const transport of this.transports.values()) {
      transport.close();
    }
    this.transports.clear();

    if (count > 0) {
      log.info({ count }, 'closed all pooled SMTP transports');
    }
  }

  /** Number of live cached transports — used by the smoke test. */
  get size(): number {
    return this.transports.size;
  }
}

export const smtpPool = new SmtpPool();
