import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { env } from "~/env";
import { PrismaClient } from "../../generated/prisma";

const createPool = () =>
  new Pool({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
    query_timeout: 20000,
    keepAlive: true,
  });

const createPrismaClient = (pool: Pool) =>
  new PrismaClient({
    adapter: new PrismaPg(pool),
    log: env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaPool: Pool | undefined;
};

export const dbPool = globalForPrisma.prismaPool ?? createPool();
export const db = globalForPrisma.prisma ?? createPrismaClient(dbPool);

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
  globalForPrisma.prismaPool = dbPool;
}
