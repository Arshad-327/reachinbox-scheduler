import type { Server } from 'node:http';

import { prisma } from './prisma.js';
import { logger } from './logger.js';
import { smtpPool } from '../services/smtp.service.js';
import { closeRateLimiter } from '../services/rateLimit.service.js';

/** How long to wait for in-flight work before forcing the process down. */
const FORCE_EXIT_MS = 10_000;

export interface ShutdownOptions {
  /** Label for the log lines, e.g. 'api' or 'worker'. */
  name: string;
  /** HTTP server to stop accepting connections on. Omit for the worker. */
  server?: Server;
  /** Process-specific teardown (close queues, drain workers) before Prisma. */
  cleanup?: () => Promise<void>;
}

/**
 * Registers SIGINT/SIGTERM handlers that drain in order and log each stage.
 * Shared by the API and the worker so both die the same way.
 */
export function registerShutdownHandlers({ name, server, cleanup }: ShutdownOptions): void {
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      logger.warn({ signal, name }, 'shutdown already in progress, ignoring signal');
      return;
    }
    shuttingDown = true;

    logger.info({ signal, name }, `${name}: received ${signal}, starting graceful shutdown`);

    const forceTimer = setTimeout(() => {
      logger.error({ name }, `${name}: graceful shutdown timed out, forcing exit`);
      process.exit(1);
    }, FORCE_EXIT_MS);
    forceTimer.unref();

    try {
      if (server) {
        await new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        });
        logger.info({ name }, `${name}: http server closed`);
      }

      if (cleanup) {
        await cleanup();
        logger.info({ name }, `${name}: cleanup complete`);
      }

      // Before Prisma: draining SMTP can still want to log, and closing the
      // pools releases sockets the process would otherwise keep alive.
      smtpPool.closeAll();
      logger.info({ name }, `${name}: smtp transports closed`);

      await closeRateLimiter();
      logger.info({ name }, `${name}: rate limiter connection closed`);

      await prisma.$disconnect();
      logger.info({ name }, `${name}: prisma disconnected`);

      logger.info({ name }, `${name}: shutdown complete`);
      clearTimeout(forceTimer);
      process.exit(0);
    } catch (err) {
      logger.error({ name, err }, `${name}: error during shutdown`);
      clearTimeout(forceTimer);
      process.exit(1);
    }
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }
}
