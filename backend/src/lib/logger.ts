import pino from 'pino';
import { env, isDev } from '../config/env.js';

/**
 * Pretty, human-readable output in development; structured JSON everywhere
 * else so logs stay machine-parseable in production.
 */
export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : isDev ? 'debug' : 'info',
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),
});

/** Child logger with a fixed `scope` field, e.g. logger.child({ scope: 'worker' }). */
export const createLogger = (scope: string) => logger.child({ scope });
