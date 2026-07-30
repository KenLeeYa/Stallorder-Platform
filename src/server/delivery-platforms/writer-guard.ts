import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DeliveryPlatformError } from "./delivery-platform-errors";

type WriterDatabase = Pick<Prisma.TransactionClient, "$queryRaw">;

export async function assertDeliveryWriter(database: WriterDatabase = prisma) {
  try {
    await database.$queryRaw`
      select app_private.assert_backend_writable(null)
    `;
  } catch {
    throw new DeliveryPlatformError("BACKEND_NOT_WRITABLE", { retryable: true });
  }
}
