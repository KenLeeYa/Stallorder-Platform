import "server-only";

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { calculateCashExpected } from "@/lib/operational-calculations";
import { prisma } from "@/lib/prisma";

const uuid = z.string().uuid();
const nullableNote = z.string().trim().min(1).max(500).nullable().optional();

export const cashShiftCommandSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("OPEN"),
    openingAmount: z.number().int().min(0).max(100_000_000),
    note: nullableNote,
  }).strict(),
  z.object({
    operation: z.literal("MOVE"),
    shiftId: uuid,
    type: z.enum(["CASH_IN", "CASH_OUT"]),
    amount: z.number().int().min(1).max(100_000_000),
    reason: z.string().trim().min(1).max(200),
    managerAuthorizationCode: z.string().trim().regex(/^\d{6,8}$/).optional(),
  }).strict(),
  z.object({
    operation: z.literal("CLOSE"),
    shiftId: uuid,
    countedAmount: z.number().int().min(0).max(100_000_000),
    note: nullableNote,
  }).strict(),
  z.object({
    operation: z.literal("REFUND"),
    shiftId: uuid,
    paymentId: uuid,
    reason: z.string().trim().min(1).max(200),
    managerAuthorizationCode: z.string().trim().regex(/^\d{6,8}$/).optional(),
  }).strict(),
  z.object({
    operation: z.literal("REVIEW"),
    shiftId: uuid,
    decision: z.enum(["APPROVED", "REJECTED", "ADJUSTMENT_REQUIRED"]),
    comment: nullableNote,
  }).strict(),
  z.object({
    operation: z.literal("ADJUST"),
    shiftId: uuid,
    amount: z.number().int().min(-100_000_000).max(100_000_000).refine((value) => value !== 0),
    reason: z.string().trim().min(1).max(200),
  }).strict(),
]).superRefine((command, context) => {
  if (command.operation === "REVIEW" && command.decision !== "APPROVED" && !command.comment) {
    context.addIssue({ code: "custom", path: ["comment"], message: "退回或要求更正時必須填寫原因。" });
  }
});

export type CashShiftCommand = z.infer<typeof cashShiftCommandSchema>;
type CashDataClient = Prisma.TransactionClient | typeof prisma;

export class CashShiftOperationError extends Error {
  constructor(public readonly code:
    | "SHIFT_NOT_FOUND"
    | "SHIFT_NOT_OPEN"
    | "SHIFT_NOT_REVIEWABLE"
    | "PAYMENT_NOT_FOUND"
    | "PAYMENT_NOT_REFUNDABLE"
    | "ACTIVE_SHIFT_REQUIRED") {
    super(code);
  }
}

export async function getCashShiftState(stallId: string, organizationId: string) {
  const shifts = await prisma.cashShift.findMany({
    where: { stallId, organizationId },
    orderBy: { openedAt: "desc" },
    take: 50,
    include: {
      openedBy: { select: { displayName: true } },
      closedBy: { select: { displayName: true } },
      movements: {
        orderBy: { createdAt: "desc" },
        include: { recordedBy: { select: { displayName: true } } },
      },
      reviews: {
        orderBy: { reviewedAt: "desc" },
        include: { reviewedBy: { select: { displayName: true } } },
      },
    },
  });
  const openShift = shifts.find((shift) => shift.status === "OPEN") ?? null;
  const refundablePayments = openShift
    ? await prisma.payment.findMany({
        where: {
          organizationId,
          stallId,
          method: "CASH",
          status: "PAID",
          amount: { gt: 0 },
          cashShiftId: { not: null },
        },
        orderBy: { paidAt: "desc" },
        take: 20,
        select: {
          id: true,
          amount: true,
          paidAt: true,
          order: { select: { orderNo: true } },
        },
      })
    : [];

  return {
    openShift: openShift ? {
      ...openShift,
      ...(await getCashShiftRuntimeTotals(prisma, openShift)),
    } : null,
    history: shifts.filter((shift) => shift.status !== "OPEN"),
    refundablePayments,
  };
}

export async function getCashShiftRuntimeTotals(
  client: CashDataClient,
  shift: { id: string; stallId: string; openingAmount: number },
) {
  const movements = await client.cashMovement.groupBy({
    by: ["type"],
    where: { cashShiftId: shift.id },
    _sum: { amount: true },
  });
  const amountFor = (type: "CASH_SALE" | "CASH_IN" | "CASH_OUT" | "CASH_REFUND" | "CORRECTION") => (
    movements.find((movement) => movement.type === type)?._sum.amount ?? 0
  );
  const cashSales = amountFor("CASH_SALE");
  const cashIn = amountFor("CASH_IN");
  const cashOut = amountFor("CASH_OUT");
  const cashRefund = amountFor("CASH_REFUND");
  const correction = amountFor("CORRECTION");
  return {
    cashSales,
    cashIn,
    cashOut,
    cashRefund,
    correction,
    expectedAmount: calculateCashExpected({
      openingAmount: shift.openingAmount,
      cashSales,
      cashIn,
      cashOut,
      cashRefund,
      correction,
    }),
  };
}

export async function requireOpenCashShift(
  client: CashDataClient,
  organizationId: string,
  stallId: string,
) {
  const rows = await client.$queryRaw<Array<{ id: string }>>`
    select shift.id
    from public.cash_shifts shift
    where shift.organization_id = ${organizationId}::uuid
      and shift.stall_id = ${stallId}::uuid
      and shift.status = 'OPEN'::public.cash_shift_status
    order by shift.opened_at desc
    limit 1
    for update
  `;
  if (!rows[0]) throw new CashShiftOperationError("ACTIVE_SHIFT_REQUIRED");
  return rows[0].id;
}

export async function executeCashShiftCommand(input: {
  organizationId: string;
  stallId: string;
  actorProfileId: string;
  reconciliationEnabled: boolean;
  command: CashShiftCommand;
}) {
  return prisma.$transaction(async (transaction) => {
    const { command } = input;
    if (command.operation === "OPEN") {
      const shift = await transaction.cashShift.create({
        data: {
          organizationId: input.organizationId,
          stallId: input.stallId,
          openingAmount: command.openingAmount,
          note: command.note ?? null,
          openedById: input.actorProfileId,
        },
      });
      if (command.openingAmount > 0) {
        await transaction.cashMovement.create({
          data: {
            organizationId: input.organizationId,
            stallId: input.stallId,
            cashShiftId: shift.id,
            type: "OPENING_FLOAT",
            amount: command.openingAmount,
            reason: "開班預備金",
            referenceType: "CASH_SHIFT",
            referenceId: shift.id,
            recordedById: input.actorProfileId,
          },
        });
      }
      return resultFor(command, shift.id);
    }

    const shift = await lockCashShift(transaction, input, command.shiftId);

    if (command.operation === "MOVE") {
      assertShiftStatus(shift.status, "OPEN");
      const movement = await transaction.cashMovement.create({
        data: {
          organizationId: input.organizationId,
          stallId: input.stallId,
          cashShiftId: shift.id,
          type: command.type,
          amount: command.amount,
          reason: command.reason,
          recordedById: input.actorProfileId,
        },
      });
      return resultFor(command, movement.id, shift.id);
    }

    if (command.operation === "REFUND") {
      assertShiftStatus(shift.status, "OPEN");
      const payment = await transaction.payment.findFirst({
        where: {
          id: command.paymentId,
          organizationId: input.organizationId,
          stallId: input.stallId,
          method: "CASH",
        },
        select: { id: true, orderId: true, amount: true, status: true },
      });
      if (!payment) throw new CashShiftOperationError("PAYMENT_NOT_FOUND");
      if (payment.status !== "PAID" || payment.amount <= 0) {
        throw new CashShiftOperationError("PAYMENT_NOT_REFUNDABLE");
      }
      const changed = await transaction.payment.updateMany({
        where: { id: payment.id, status: "PAID" },
        data: { status: "REFUNDED" },
      });
      if (changed.count !== 1) throw new CashShiftOperationError("PAYMENT_NOT_REFUNDABLE");
      await transaction.order.updateMany({
        where: { id: payment.orderId, stallId: input.stallId, paymentStatus: "PAID" },
        data: { paymentStatus: "REFUNDED" },
      });
      const movement = await transaction.cashMovement.create({
        data: {
          organizationId: input.organizationId,
          stallId: input.stallId,
          cashShiftId: shift.id,
          type: "CASH_REFUND",
          amount: payment.amount,
          reason: command.reason,
          referenceType: "PAYMENT",
          referenceId: payment.id,
          recordedById: input.actorProfileId,
        },
      });
      return resultFor(command, movement.id, shift.id, { paymentId: payment.id, amount: payment.amount });
    }

    if (command.operation === "CLOSE") {
      assertShiftStatus(shift.status, "OPEN");
      const totals = await getCashShiftRuntimeTotals(transaction, shift);
      const nextStatus = input.reconciliationEnabled ? "CLOSING" : "CLOSED";
      const changed = await transaction.cashShift.updateMany({
        where: { id: shift.id, status: "OPEN" },
        data: {
          status: nextStatus,
          systemExpectedAmount: totals.expectedAmount,
          countedAmount: command.countedAmount,
          varianceAmount: command.countedAmount - totals.expectedAmount,
          note: command.note ?? shift.note,
          closedById: input.actorProfileId,
          closedAt: new Date(),
        },
      });
      if (changed.count !== 1) throw new CashShiftOperationError("SHIFT_NOT_OPEN");
      await refreshCashShiftAlerts(transaction);
      return resultFor(command, shift.id, shift.id, {
        expectedAmount: totals.expectedAmount,
        actualAmount: command.countedAmount,
        differenceAmount: command.countedAmount - totals.expectedAmount,
        reviewRequired: input.reconciliationEnabled,
      });
    }

    if (command.operation === "ADJUST") {
      if (shift.status !== "REVIEW_REQUIRED") {
        throw new CashShiftOperationError("SHIFT_NOT_REVIEWABLE");
      }
      const movement = await transaction.cashMovement.create({
        data: {
          organizationId: input.organizationId,
          stallId: input.stallId,
          cashShiftId: shift.id,
          type: "CORRECTION",
          amount: command.amount,
          reason: command.reason,
          recordedById: input.actorProfileId,
        },
      });
      const totals = await getCashShiftRuntimeTotals(transaction, shift);
      await transaction.cashShift.update({
        where: { id: shift.id },
        data: {
          status: "CLOSING",
          systemExpectedAmount: totals.expectedAmount,
          varianceAmount: (shift.countedAmount ?? 0) - totals.expectedAmount,
        },
      });
      await refreshCashShiftAlerts(transaction);
      return resultFor(command, movement.id, shift.id, {
        amount: command.amount,
        differenceAmount: (shift.countedAmount ?? 0) - totals.expectedAmount,
      });
    }

    if (!input.reconciliationEnabled || !["CLOSING", "REVIEW_REQUIRED"].includes(shift.status)) {
      throw new CashShiftOperationError("SHIFT_NOT_REVIEWABLE");
    }
    const review = await transaction.cashShiftReview.create({
      data: {
        organizationId: input.organizationId,
        stallId: input.stallId,
        cashShiftId: shift.id,
        reviewedByProfileId: input.actorProfileId,
        decision: command.decision,
        comment: command.comment ?? null,
      },
    });
    await transaction.cashShift.update({
      where: { id: shift.id },
      data: { status: command.decision === "APPROVED" ? "CLOSED" : "REVIEW_REQUIRED" },
    });
    await refreshCashShiftAlerts(transaction);
    return resultFor(command, review.id, shift.id, { decision: command.decision });
  }, { isolationLevel: "Serializable" });
}

async function lockCashShift(
  transaction: Prisma.TransactionClient,
  scope: { organizationId: string; stallId: string },
  shiftId: string,
) {
  await transaction.$queryRaw`
    select shift.id from public.cash_shifts shift
    where shift.id = ${shiftId}::uuid
    for update
  `;
  const shift = await transaction.cashShift.findFirst({
    where: {
      id: shiftId,
      organizationId: scope.organizationId,
      stallId: scope.stallId,
    },
  });
  if (!shift) throw new CashShiftOperationError("SHIFT_NOT_FOUND");
  return shift;
}

function assertShiftStatus(status: string, expected: "OPEN") {
  if (status !== expected) throw new CashShiftOperationError("SHIFT_NOT_OPEN");
}

async function refreshCashShiftAlerts(transaction: Prisma.TransactionClient) {
  await transaction.$queryRaw`select app_private.refresh_cash_shift_alerts()`;
}

function resultFor(
  command: CashShiftCommand,
  entityId: string,
  shiftId: string = entityId,
  metadata: Record<string, string | number | boolean | null> = {},
) {
  return {
    entityId,
    shiftId,
    action: `CASH_SHIFT_${command.operation}`,
    entityType: command.operation === "MOVE" || command.operation === "REFUND" || command.operation === "ADJUST"
      ? "CASH_MOVEMENT"
      : command.operation === "REVIEW"
        ? "CASH_SHIFT_REVIEW"
        : "CASH_SHIFT",
    metadata: {
      operation: command.operation,
      ...(command.operation === "MOVE" ? { type: command.type, amount: command.amount, reason: command.reason } : {}),
      ...(command.operation === "REFUND" ? { reason: command.reason } : {}),
      ...(command.operation === "ADJUST" ? { reason: command.reason } : {}),
      ...metadata,
    },
  };
}
