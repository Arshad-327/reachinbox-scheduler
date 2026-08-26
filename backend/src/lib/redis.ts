import { Redis, type RedisOptions } from 'ioredis';
import { env } from '../config/env.js';

/**
 * BullMQ requires `maxRetriesPerRequest: null` on every connection it owns —
 * its blocking commands (BRPOPLPUSH etc.) sit open far longer than ioredis'
 * default retry budget, and anything else makes workers die mid-poll.
 */
export const baseRedisOptions: RedisOptions = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

/**
 * Create a new Redis connection. BullMQ wants a dedicated connection per
 * Queue/Worker/QueueEvents instance, so this is a factory, not a singleton.
 */
export function createRedisConnection(overrides: RedisOptions = {}): Redis {
  return new Redis({ ...baseRedisOptions, ...overrides });
}
