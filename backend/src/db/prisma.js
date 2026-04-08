import { PrismaClient } from '@prisma/client';

// Prisma Client singleton
// Prevents multiple instances during hot-reloading in development
// https://www.prisma.io/docs/guides/performance-and-optimization/connection-management

const globalForPrisma = globalThis;

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
