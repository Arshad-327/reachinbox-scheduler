import { PrismaClient } from '@prisma/client';
import { isDev } from '../config/env.js';

/**
 * Cached on globalThis so `tsx watch` reloads reuse one connection pool
 * instead of leaking a new client on every file change.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isDev ? ['warn', 'error'] : ['error'],
  });

if (isDev) {
  globalForPrisma.prisma = prisma;
}
