import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

let prismaClient: PrismaClient | undefined;

function getDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required for Prisma runtime database access. Configure it in Vercel Production and Preview environments.",
    );
  }

  try {
    const parsed = new URL(databaseUrl);
    if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
      throw new Error("invalid protocol");
    }
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection string.");
  }

  return databaseUrl;
}

function createPrismaClient() {
  return new PrismaClient({
    datasources: {
      db: {
        url: getDatabaseUrl(),
      },
    },
  });
}

export function getPrismaClient() {
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma ??= createPrismaClient();
    return globalForPrisma.prisma;
  }

  prismaClient ??= createPrismaClient();
  return prismaClient;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const client = getPrismaClient();
    const value = Reflect.get(client, property, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
