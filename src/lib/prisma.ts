import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

/** Interactive transactions over the Supabase pooler (≈400–500 ms/query). */
export const WRITE_TX = { maxWait: 10_000, timeout: 20_000 } as const;

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
