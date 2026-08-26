import type { Redis } from 'ioredis';

import { createRedisConnection } from '../lib/redis.js';

/**
 * Namespace for every BullMQ key in Redis. Without a prefix BullMQ writes to
 * `bull:<queue>:*`, which collides with any other project pointed at the same
 * instance — and this dev box shares one Redis container.
 */
export const QUEUE_PREFIX = 'reachinbox';

/**
 * BullMQ needs a DEDICATED connection per Queue / Worker / QueueEvents: its
 * blocking reads occupy a connection for the whole poll, so sharing one would
 * serialise every component behind a single socket.
 *
 * The BullMQ-mandated options (maxRetriesPerRequest: null, enableReadyCheck:
 * false) live in src/lib/redis.ts and are inherited here, so there is exactly
 * one place that knows how to talk to Redis.
 */
export function createQueueConnection(): Redis {
  return createRedisConnection();
}
