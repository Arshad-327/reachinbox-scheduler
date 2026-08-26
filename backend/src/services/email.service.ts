import nodemailer from 'nodemailer';
import type { Sender } from '@prisma/client';

import { createLogger } from '../lib/logger.js';
import { smtpPool } from './smtp.service.js';

const log = createLogger('email');

export interface SendEmailParams {
  sender: Sender;
  to: string;
  toName?: string;
  subject: string;
  bodyHtml: string;
  /** Also becomes the Message-ID, so a row in the DB maps to a real message. */
  idempotencyKey: string;
}

export type SendResult =
  | { ok: true; messageId: string; previewUrl: string | null; acceptedAt: Date }
  | { ok: false; error: string; code?: string; isRetryable: boolean };

/** Transient conditions — the same message may well succeed on a later attempt. */
const RETRYABLE_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'ECONNECTION', 'ESOCKET', 'EDNS']);

/**
 * Permanent conditions. Retrying these burns attempts and, for EAUTH, hammers
 * an account that is already refusing us:
 *   EAUTH     — bad credentials; every retry fails identically.
 *   EENVELOPE — the from/to addresses were rejected; the message is malformed.
 */
const PERMANENT_CODES = new Set(['EAUTH', 'EENVELOPE']);

interface SmtpError extends Error {
  code?: string;
  responseCode?: number;
  response?: string;
}

/**
 * Retryable vs permanent drives the worker's retry logic, so the asymmetry
 * matters: marking a transient failure "permanent" silently drops a real
 * email, while marking a permanent one "retryable" only wastes a couple of
 * attempts before it fails anyway. The cheap mistake is the second one, so
 * anything unrecognised is treated as retryable.
 *
 * SMTP reply codes carry the same distinction natively: 4xx is an explicit
 * "try again later" (greylisting, mailbox busy, rate limited), 5xx is a
 * refusal (550 no such user, 553 bad address).
 */
export function classifySendError(err: SmtpError): { isRetryable: boolean; code?: string } {
  const code = err.code;

  if (code && PERMANENT_CODES.has(code)) {
    return { isRetryable: false, code };
  }
  if (code && RETRYABLE_CODES.has(code)) {
    return { isRetryable: true, code };
  }

  const responseCode = err.responseCode;
  if (typeof responseCode === 'number') {
    if (responseCode >= 500 && responseCode <= 599) {
      return { isRetryable: false, code };
    }
    if (responseCode >= 400 && responseCode <= 499) {
      return { isRetryable: true, code };
    }
  }

  return { isRetryable: true, code };
}

/**
 * Crude tag-strip for the plaintext alternative. Deliberately not a parser:
 * it does not understand nested/malformed markup, CSS-hidden content, tables,
 * or the full HTML entity set — only the handful of entities below. Campaign
 * bodies here are simple marketing HTML, so this is adequate; anything richer
 * should use a real converter (html-to-text) rather than growing this regex.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|table)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    // &amp; is decoded last so "&amp;lt;" survives as the literal "&lt;"
    // instead of collapsing into "<".
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Sends one email through the sender's pooled transport.
 *
 * NEVER throws for a send failure — the worker needs a value it can branch on
 * to decide retry vs. mark-failed, and an exception would conflate "this email
 * bounced" with "the scheduler is broken".
 */
export async function sendEmail(params: SendEmailParams): Promise<SendResult> {
  const { sender, to, toName, subject, bodyHtml, idempotencyKey } = params;
  const startedAt = Date.now();

  // Deterministic, derived from the idempotency key. A real provider (SES,
  // Postmark) would dedupe on this header, so a double-delivered job collapses
  // into one message; against Ethereal it has no dedupe effect but makes a
  // DB row traceable to an actual message end to end.
  const messageId = `<${idempotencyKey}@reachinbox.local>`;

  try {
    const info = await smtpPool.getTransport(sender).sendMail({
      from: `"${sender.fromName}" <${sender.email}>`,
      to: toName ? `"${toName}" <${to}>` : to,
      subject,
      html: bodyHtml,
      text: htmlToText(bodyHtml),
      messageId,
    });

    // The pooled transport reports SMTPPool.SentMessageInfo, which lacks the
    // `pending` field that @types/nodemailer's getTestMessageUrl signature
    // demands. At runtime the helper reads only `info.response`, so the shapes
    // are compatible where it counts — this cast bridges the type gap only.
    const preview = nodemailer.getTestMessageUrl(
      info as unknown as Parameters<typeof nodemailer.getTestMessageUrl>[0],
    );
    const previewUrl = preview === false ? null : preview;
    const durationMs = Date.now() - startedAt;

    log.info(
      { senderId: sender.id, to, messageId: info.messageId, durationMs, previewUrl },
      'email sent',
    );

    return {
      ok: true,
      messageId: info.messageId,
      previewUrl,
      acceptedAt: new Date(),
    };
  } catch (err) {
    const smtpErr = err as SmtpError;
    const { isRetryable, code } = classifySendError(smtpErr);
    const durationMs = Date.now() - startedAt;
    const error = smtpErr.response ?? smtpErr.message ?? String(err);

    // These are throwaway Ethereal accounts, so the address and the raw SMTP
    // response are logged in full — there is nothing here worth redacting.
    log.warn(
      { senderId: sender.id, to, code, responseCode: smtpErr.responseCode, isRetryable, durationMs, error },
      'email send failed',
    );

    return { ok: false, error, ...(code === undefined ? {} : { code }), isRetryable };
  }
}
