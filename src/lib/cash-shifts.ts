import "server-only";

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { calculateCashExpected } from "@/lib/operational-calculations";
import { prisma } from "@/lib/prisma";

const uuid = z.string().uuid();
export const cashShiftCommandSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("OPEN"),
    openingAmount: z.number().int().min(0).max(100_000_000),
    note: z.string().trim().min(1).max(500).nullable().optional(),
  }).strict(),
  z.object({
    operation: z.literal("MOVE"),
    shiftId: uuid,
    type: z.enum(["CASH_IN", "CASH_OUT"]),
    amount: z.number().int().min(1).max(100_000_000),
    reason: z.string().trim().min(1).max(200),
  }).strict(),
  z.object({
    operation: z.literal("CLOSE"),
    shiftId: uuid,
    countedAmount: z.number().int().min(0).max(100_000_000),
    note: z.string().trim().min(1).max(500).nullable().optional(),
  }).strict(),
]);

export async function getCashShiftState(stallId: string, organizationId: string) {
  const shifts = await prisma.cashShift.findMany({
    where: { stallId, organizationId },
    orderBy: { openedAt: "desc" },
    take: 20,
    include: {
      openedBy: { select: { displayName: true } },
      closedBy: { select: { displayName: true } },
      movements: {
        orderBy: { createdAt: "desc" },
        include: { recordedBy: { select: { displayName: true } } },
      },
    },
  });
  const openShift = shifts.find((shift) => shift.status === "OPEN") ?? null;
  return {
    openShift: openShift ? {
      ...openShift,
      ...(await getCashShiftRuntimeTotals(prisma, openShift)),
    } : null,
    history: shifts.filter((shift) => shift.status === "CLOSED"),
  };
}

export async function getCashShiftRuntimeTotals(
  client: Prisma.TransactionClient | typeof prisma,
  shift: { id: string; stallId: string; openingAmount: number; openedAt: Date; closedAt?: Date | null },
) {
  const [payments, movements] = await Promise.all([
    client.payment.aggregate({
      where: {
        stallId: shift.stallId,
        status: "PAID",
        method: "CASH",
        paidAt: {
          gte: shift.openedAt,
          ...(shift.closedAt ? { lte: shift.closedAt } : {}),
        },
      },
      _sum: { amount: true },
    }),
    client.cashMovement.groupBy({
      by: ["type"],
      where: { cashShiftId: shift.id },
      _sum: { amount: true },
    }),
  ]);
  const cashSales = payments._sum.amount ?? 0;
  const cashIn = movements.find((movement) => movement.type === "CASH_IN")?._sum.amount ?? 0;
  const cashOut = movements.find((movement) => movement.type === "CASH_OUT")?._sum.amount ?? 0;
  return {
    cashSales,
    cashIn,
    cashOut,
    expectedAmount: calculateCashExpected({ openingAmount: shift.openingAmount, cashSales, cashIn, cashOut }),
  };
}
