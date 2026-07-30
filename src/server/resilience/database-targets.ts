import "server-only";

import { PrismaClient } from "@prisma/client";

const globalForResilienceDatabases = globalThis as unknown as {
  resilienceDrPrisma?: PrismaClient;
};

function validatePostgresUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
      throw new Error("invalid protocol");
    }
  } catch {
    throw new Error("DR_DATABASE_URL_INVALID");
  }
}

export function isDrDatabaseConfigured() {
  return Boolean(process.env.DR_DATABASE_URL?.trim());
}

export function getDrPrismaClient() {
  const databaseUrl = process.env.DR_DATABASE_URL?.trim();
  if (!databaseUrl) return null;

  validatePostgresUrl(databaseUrl);
  globalForResilienceDatabases.resilienceDrPrisma ??= new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });
  return globalForResilienceDatabases.resilienceDrPrisma;
}
