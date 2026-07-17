import { prisma } from "@/lib/prisma";

export type ProcessOrdersCronResult = {
  expiredUnconfirmedOrders: number;
};

export async function processOrdersCron(): Promise<ProcessOrdersCronResult> {
  const rows = await prisma.$queryRaw<Array<{ expired_count: number | bigint }>>`
    select public.expire_unconfirmed_orders() as expired_count
  `;
  const expiredCount = rows[0]?.expired_count ?? 0;
  return {
    expiredUnconfirmedOrders: Number(expiredCount),
  };
}
