import type { Redis } from 'ioredis';

import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { createRedisConnection } from '../lib/redis.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('ratelimit');

/**
 * ============================================================================
 * HOURLY RATE LIMITING
 * ============================================================================
 *
 * WHY THIS IS NOT BULLMQ'S LIMITER
 * --------------------------------
 * BullMQ's `limiter: { max, duration }` is a SINGLE bucket for the whole
 * queue. It is exactly right for the minimum-spacing rule (max: 1 per
 * MIN_DELAY_BETWEEN_EMAILS_MS) and it is used for that. But it cannot express
 * "N per hour PER SENDER": there is one bucket, not one per sender, and no way
 * to key it dynamically per job. It also cannot express "check two limits and
 * consume neither unless both pass".
 *
 * So the hourly cap is a separate, Redis-backed check performed inside the
 * processor, before the job is claimed. The two mechanisms are complementary:
 * BullMQ paces the stream, this caps the volume.
 *
 * WHY LUA
 * -------
 * Check-then-increment across multiple keys is a read-modify-write race: two
 * workers can both read 99/100 and both send, taking the sender to 101. A Lua
 * script runs atomically inside Redis, so the check and the increments are one
 * indivisible step no matter how many workers are running. This is also why a
 * partial consume is impossible — see below.
 *
 * WHY "INCREMENT NOTHING ON PARTIAL FAILURE" MATTERS
 * --------------------------------------------------
 * Under the 'both' strategy the script verifies EVERY scope before touching
 * ANY of them. If the global limit is exhausted but the sender still has room,
 * a naive implementation would have already incremented the sender before
 * discovering the global rejection — silently burning that sender's quota for
 * an email that never went out. Over a busy hour that leaks a large fraction of
 * per-sender capacity. Check-all-then-increment-all removes the possibility.
 *
 * ============================================================================
 * BEHAVIOUR UNDER LOAD — 1000 emails scheduled for the same instant,
 * limit 100/hour/sender
 * ============================================================================
 * All 1000 jobs become due at once and the worker starts draining them,
 * spaced by the BullMQ limiter (one start per MIN_DELAY_BETWEEN_EMAILS_MS).
 *
 *   Hour 0: the first 100 jobs call tryConsume, each finds the counter below
 *           100, increments it, and sends. Job 101 finds the counter at 100.
 *           It is NOT failed and NOT dropped: it is re-enqueued with a delay
 *           of (time until the hour rolls over) + a small per-sequence jitter,
 *           and its DB row stays SCHEDULED with scheduledAt moved forward.
 *           Jobs 101-1000 all take that path. 100 sent, 900 deferred.
 *   Hour 1: the counter key has expired, so the first 100 of the deferred set
 *           consume the fresh window and send. 800 deferred again.
 *   Hour 2: 100 more. ... and so on.
 *   Hour 9: the final 100 send. Total drain time ~10 hours.
 *
 * Properties that hold throughout:
 *   - NOTHING IS DROPPED. A rate-limited job is always re-enqueued.
 *   - NOTHING IS DUPLICATED. The re-added job carries a deterministic id
 *     derived from the idempotency key plus its target hour window, and the
 *     worker's conditional-claim guard is the backstop.
 *   - NO JOB IS MARKED FAILED. Being rate limited is not an error; attempts is
 *     never incremented, so hitting the cap cannot exhaust a job's retries.
 *   - ORDER IS APPROXIMATELY PRESERVED. Deferred jobs are re-delayed with a
 *     jitter of (sequence * 50ms), so within a spill group they come back in
 *     ascending sequence order. This is approximate, not a strict FIFO
 *     guarantee — see the ordering note in email.worker.ts.
 *
 * The same shape applies to the global scope; only the bucket differs.
 */

/** 2h TTL: one full window plus a margin, so keys self-clean without a sweeper. */
const KEY_TTL_SECONDS = 7200;

const KEY_NAMESPACE = 'reachinbox:ratelimit';

export const GLOBAL_SCOPE = 'global';
export const senderScope = (senderId: string) => `sender:${senderId}`;

/** UTC hour bucket, e.g. 2026-08-26T10. */
export function hourBucket(at: Date = new Date()): string {
  return at.toISOString().slice(0, 13);
}

/** Start of the UTC hour containing `at` — the RateLimitWindow.hourStart value. */
export function hourStart(at: Date = new Date()): Date {
  const d = new Date(at);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

export function msUntilNextHour(at: Date = new Date()): number {
  const next = hourStart(at).getTime() + 3_600_000;
  return next - at.getTime();
}

const redisKey = (scope: string, bucket: string) => `${KEY_NAMESPACE}:${scope}:${bucket}`;

/**
 * Check EVERY scope, then increment EVERY scope — or increment nothing.
 *
 * KEYS: one per scope.
 * ARGV: [limit per scope..., ttlSeconds]
 * Returns: {1, 0} when consumed, or {0, blockedIndex} naming the 1-based scope
 * that was already at its limit.
 */
const CONSUME_LUA = `
local n = #KEYS
for i = 1, n do
  local current = tonumber(redis.call('GET', KEYS[i]) or '0')
  if current >= tonumber(ARGV[i]) then
    return {0, i}
  end
end
for i = 1, n do
  local value = redis.call('INCR', KEYS[i])
  if value == 1 then
    redis.call('EXPIRE', KEYS[i], tonumber(ARGV[n + 1]))
  end
end
return {1, 0}
`;

/** Never let a refund drive a counter negative. */
const REFUND_LUA = `
for i = 1, #KEYS do
  local current = tonumber(redis.call('GET', KEYS[i]) or '0')
  if current > 0 then
    redis.call('DECR', KEYS[i])
  end
end
return 1
`;

interface RateLimitRedis extends Redis {
  rlConsume(numKeys: number, ...args: (string | number)[]): Promise<[number, number]>;
  rlRefund(numKeys: number, ...args: (string | number)[]): Promise<number>;
}

let client: RateLimitRedis | null = null;

/** Lazily created so importing this module does not open a socket. */
function getClient(): RateLimitRedis {
  if (client) {
    return client;
  }

  const c = createRedisConnection() as RateLimitRedis;
  c.defineCommand('rlConsume', { lua: CONSUME_LUA });
  c.defineCommand('rlRefund', { lua: REFUND_LUA });
  client = c;
  return c;
}

export async function closeRateLimiter(): Promise<void> {
  if (!client) {
    return;
  }
  await client.quit();
  client = null;
}

export interface Scope {
  /** "sender:<id>" or "global". */
  name: string;
  limit: number;
}

/**
 * Which scopes apply, per env.RATE_LIMIT_STRATEGY. A sender's own
 * hourlyLimit column overrides the env default when set.
 */
export async function resolveScopes(senderId: string): Promise<Scope[]> {
  const strategy = env.RATE_LIMIT_STRATEGY;

  const scopes: Scope[] = [];

  if (strategy === 'per_sender' || strategy === 'both') {
    const sender = await prisma.sender.findUnique({
      where: { id: senderId },
      select: { hourlyLimit: true },
    });

    scopes.push({
      name: senderScope(senderId),
      limit: sender?.hourlyLimit ?? env.MAX_EMAILS_PER_HOUR_PER_SENDER,
    });
  }

  if (strategy === 'global' || strategy === 'both') {
    scopes.push({ name: GLOBAL_SCOPE, limit: env.MAX_EMAILS_PER_HOUR_GLOBAL });
  }

  return scopes;
}

export type ConsumeResult =
  | { allowed: true }
  | { allowed: false; blockedBy: string; retryAfterMs: number };

/**
 * Atomically reserve one send slot for this sender.
 *
 * TRADE-OFF — WE CONSUME BEFORE SENDING, NOT AFTER.
 * A slot is taken before the SMTP conversation starts, so if the process is
 * killed mid-send the slot stays consumed and we very slightly UNDER-send for
 * that hour. The alternative (increment after a successful send) would let N
 * concurrent workers all pass the check and blow through a provider's cap,
 * which gets an account suspended. Under-sending is recoverable; exceeding a
 * provider limit is not. `refund()` exists for the narrow case where we know
 * SMTP was never contacted.
 */
export async function tryConsume(senderId: string, at: Date = new Date()): Promise<ConsumeResult> {
  const scopes = await resolveScopes(senderId);

  // An empty scope set would mean "no limits configured" — allow rather than
  // silently block every send.
  if (scopes.length === 0) {
    return { allowed: true };
  }

  const bucket = hourBucket(at);
  const keys = scopes.map((s) => redisKey(s.name, bucket));
  const limits = scopes.map((s) => s.limit);

  const [ok, blockedIndex] = await getClient().rlConsume(
    keys.length,
    ...keys,
    ...limits,
    KEY_TTL_SECONDS,
  );

  if (ok === 1) {
    // Fire and forget: the durable mirror must never delay or fail a send.
    void mirrorIncrement(scopes, at);
    return { allowed: true };
  }

  const blocked = scopes[blockedIndex - 1];
  return {
    allowed: false,
    blockedBy: blocked?.name ?? 'unknown',
    retryAfterMs: msUntilNextHour(at),
  };
}

/**
 * Give a slot back. Only correct when we consumed but never reached SMTP —
 * e.g. the row vanished between the check and the claim. Do NOT refund a
 * failed send: the provider saw that attempt and counted it.
 */
export async function refund(senderId: string, at: Date = new Date()): Promise<void> {
  const scopes = await resolveScopes(senderId);
  if (scopes.length === 0) {
    return;
  }

  const bucket = hourBucket(at);
  const keys = scopes.map((s) => redisKey(s.name, bucket));

  await getClient().rlRefund(keys.length, ...keys);
  void mirrorDecrement(scopes, at);

  log.debug({ senderId, scopes: scopes.map((s) => s.name) }, 'refunded rate limit slot');
}

export interface ScopePeek {
  scope: string;
  count: number;
  limit: number;
  remaining: number;
  ttlSeconds: number;
}

export interface PeekResult {
  windowStart: string;
  windowResetsInMs: number;
  strategy: string;
  scopes: ScopePeek[];
}

/** Read-only view for the dashboard. Never mutates a counter. */
export async function peek(senderId: string, at: Date = new Date()): Promise<PeekResult> {
  const scopes = await resolveScopes(senderId);
  const bucket = hourBucket(at);
  const redis = getClient();

  const result: ScopePeek[] = [];
  for (const scope of scopes) {
    const key = redisKey(scope.name, bucket);
    const [raw, ttl] = await Promise.all([redis.get(key), redis.ttl(key)]);
    const count = raw ? Number.parseInt(raw, 10) : 0;

    result.push({
      scope: scope.name,
      count,
      limit: scope.limit,
      remaining: Math.max(0, scope.limit - count),
      ttlSeconds: ttl,
    });
  }

  return {
    windowStart: hourStart(at).toISOString(),
    windowResetsInMs: msUntilNextHour(at),
    strategy: env.RATE_LIMIT_STRATEGY,
    scopes: result,
  };
}

/**
 * Durable mirror of the Redis counters. Redis stays the hot path and the
 * authority for admission decisions; Postgres is the record that survives a
 * Redis flush and can be inspected after the fact. Deliberately not awaited by
 * callers — a slow write here must never hold up an email.
 */
async function mirrorIncrement(scopes: Scope[], at: Date): Promise<void> {
  const start = hourStart(at);

  try {
    await Promise.all(
      scopes.map((scope) =>
        prisma.rateLimitWindow.upsert({
          where: { scopeKey_hourStart: { scopeKey: scope.name, hourStart: start } },
          create: { scopeKey: scope.name, hourStart: start, count: 1 },
          update: { count: { increment: 1 } },
        }),
      ),
    );
  } catch (err) {
    log.warn({ err }, 'failed to mirror rate limit counter to Postgres (send unaffected)');
  }
}

async function mirrorDecrement(scopes: Scope[], at: Date): Promise<void> {
  const start = hourStart(at);

  try {
    await prisma.rateLimitWindow.updateMany({
      where: { scopeKey: { in: scopes.map((s) => s.name) }, hourStart: start, count: { gt: 0 } },
      data: { count: { decrement: 1 } },
    });
  } catch (err) {
    log.warn({ err }, 'failed to mirror rate limit refund to Postgres');
  }
}
