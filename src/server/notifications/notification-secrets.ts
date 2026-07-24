import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type SecretDatabase = Pick<Prisma.TransactionClient, "$queryRaw">;

export async function storeNotificationSecret(
  name: string,
  value: string,
  description: string,
  database: SecretDatabase = prisma,
) {
  const [result] = await database.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    select public.store_notification_secret(
      ${name}, ${value}, ${description}
    )::text as id
  `);
  if (!result?.id) throw new Error("NOTIFICATION_SECRET_STORE_FAILED");
  return result.id;
}
export async function readNotificationSecret(
  secretId: string,
  database: SecretDatabase = prisma,
) {
  const [result] = await database.$queryRaw<Array<{ value: string | null }>>(Prisma.sql`
    select public.read_notification_secret(${secretId}::uuid) as value
  `);
  if (!result?.value) throw new Error("NOTIFICATION_SECRET_NOT_FOUND");
  return result.value;
}

export async function deleteNotificationSecret(
  secretId: string | null,
  database: SecretDatabase = prisma,
) {
  if (!secretId) return;
  await database.$queryRaw(Prisma.sql`
    select public.delete_notification_secret(${secretId}::uuid)
  `);
}
