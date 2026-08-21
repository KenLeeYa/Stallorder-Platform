import "server-only";

import type { Prisma } from "@prisma/client";

type StallCodeDatabase = Pick<Prisma.TransactionClient, "$queryRaw" | "stall">;

export class GlobalStallCodeConflictError extends Error {
  constructor() {
    super("GLOBAL_STALL_CODE_CONFLICT");
    this.name = "GlobalStallCodeConflictError";
  }
}

export async function assertGlobalStallCodeAvailable(
  database: StallCodeDatabase,
  code: string,
) {
  const normalizedCode = code.trim().toLowerCase();
  await database.$queryRaw`
    select pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(${normalizedCode}, 0)
    )::text
  `;
  const conflict = await database.stall.findFirst({
    where: { code: { equals: normalizedCode, mode: "insensitive" } },
    select: { id: true },
  });
  if (conflict) throw new GlobalStallCodeConflictError();
}
