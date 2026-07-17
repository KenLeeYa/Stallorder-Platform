import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeApiRequest } from "@/lib/authorization";
import { cashShiftCommandSchema, getCashShiftRuntimeTotals, getCashShiftState } from "@/lib/cash-shifts";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { hashClientIp } from "@/lib/security";

type RouteContext = { params: Promise<{ stallSlug: string }> };
class CashShiftNotFoundError extends Error {}
class CashShiftConflictError extends Error {}

export async function GET(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "MANAGE_CASH_SHIFT");
  if (!authorization.ok) return authorization.response;
  return NextResponse.json(
    { state: await getCashShiftState(authorization.stall.id, authorization.stall.organizationId) },
    { headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } },
  );
}

export async function POST(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "MANAGE_CASH_SHIFT");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }
  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = cashShiftCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "現金交班資料格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const command = parsed.data;
  const organizationId = authorization.stall.organizationId;
  const stallId = authorization.stall.id;
  try {
    const shiftId = await prisma.$transaction(async (transaction) => {
      if (command.operation === "OPEN") {
        const shift = await transaction.cashShift.create({
          data: {
            organizationId,
            stallId,
            openingAmount: command.openingAmount,
            note: command.note ?? null,
            openedById: authorization.principal.user.id,
          },
        });
        return shift.id;
      }

      await transaction.$queryRaw`select id from public.cash_shifts where id = ${command.shiftId}::uuid for update`;
      const shift = await transaction.cashShift.findFirst({
        where: { id: command.shiftId, organizationId, stallId },
      });
      if (!shift) throw new CashShiftNotFoundError();
      if (shift.status !== "OPEN") throw new CashShiftConflictError();

      if (command.operation === "MOVE") {
        await transaction.cashMovement.create({
          data: {
            organizationId,
            stallId,
            cashShiftId: shift.id,
            type: command.type,
            amount: command.amount,
            reason: command.reason,
            recordedById: authorization.principal.user.id,
          },
        });
        return shift.id;
      }

      const totals = await getCashShiftRuntimeTotals(transaction, shift);
      const changed = await transaction.cashShift.updateMany({
        where: { id: shift.id, status: "OPEN" },
        data: {
          status: "CLOSED",
          systemExpectedAmount: totals.expectedAmount,
          countedAmount: command.countedAmount,
          varianceAmount: command.countedAmount - totals.expectedAmount,
          note: command.note ?? shift.note,
          closedById: authorization.principal.user.id,
          closedAt: new Date(),
        },
      });
      if (changed.count !== 1) throw new CashShiftConflictError();
      return shift.id;
    });

    await recordAuditEvent({
      organizationId,
      stallId,
      actorProfileId: authorization.principal.user.id,
      action: `CASH_SHIFT_${command.operation}`,
      entityType: command.operation === "MOVE" ? "CASH_MOVEMENT" : "CASH_SHIFT",
      entityId: shiftId,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      metadata: command.operation === "MOVE" ? { type: command.type, amount: command.amount, reason: command.reason } : undefined,
    });
    return NextResponse.json(
      { state: await getCashShiftState(stallId, organizationId) },
      { headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } },
    );
  } catch (error) {
    const duplicate = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    const notFound = error instanceof CashShiftNotFoundError;
    const conflict = error instanceof CashShiftConflictError;
    return NextResponse.json(
      { error: duplicate ? "此攤位已有進行中的現金班次。" : notFound ? "找不到指定的現金班次。" : conflict ? "現金班次已由其他人關閉，請重新整理。" : "目前無法更新現金交班資料。" },
      { status: duplicate || conflict ? 409 : notFound ? 404 : 500, headers: { "x-request-id": authorization.requestId } },
    );
  }
}
