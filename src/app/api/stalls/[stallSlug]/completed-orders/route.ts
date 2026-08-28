import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { zonedCalendarDayUtcRange } from "@/lib/date-time";
import { readJson } from "@/lib/http";
import {
  ManagerAuthorizationError,
  managerAuthorizationCodeSchema,
  verifyManagerAuthorization,
} from "@/lib/manager-authorization";
import { prisma } from "@/lib/prisma";
import { hashClientIp } from "@/lib/security";

const querySchema = z.object({
  query: z.string().trim().max(80).default(""),
  status: z.enum(["ALL", "COMPLETED", "CANCELLED"]).default("ALL"),
});

const commandSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("CANCEL_COMPLETED_ORDER"),
    orderId: z.string().uuid(),
    confirmationOrderNo: z.string().trim().min(1).max(32),
    cancellationReason: z.enum(["SOLD_OUT", "CUSTOMER_CANCELLED", "WAIT_TOO_LONG", "DUPLICATE_ORDER", "OTHER"]),
    cancellationDetail: z.string().trim().min(1).max(200).nullable().optional(),
    managerAuthorizationCode: managerAuthorizationCodeSchema.nullable().optional(),
  }).strict(),
  z.object({
    operation: z.literal("CHANGE_COMPLETED_PAYMENT"),
    orderId: z.string().uuid(),
    paymentOptionId: z.string().uuid(),
    reason: z.string().trim().min(3).max(200),
    managerAuthorizationCode: managerAuthorizationCodeSchema.nullable().optional(),
  }).strict(),
]).superRefine((command, context) => {
  if (
    command.operation === "CANCEL_COMPLETED_ORDER"
    && command.cancellationReason === "OTHER"
    && !command.cancellationDetail
  ) {
    context.addIssue({ code: "custom", path: ["cancellationDetail"], message: "選擇其他原因時請填寫說明。" });
  }
});

type RouteContext = { params: Promise<{ stallSlug: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "VIEW_ORDERS");
  if (!authorization.ok) return authorization.response;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    query: url.searchParams.get("query") ?? "",
    status: url.searchParams.get("status") ?? "ALL",
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "查詢條件格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const defaultRange = zonedCalendarDayUtcRange(new Date(), authorization.stall.timezone);
  const terminalDateFilter = {
    gte: defaultRange.from,
    lt: defaultRange.to,
  };
  const terminalFilter: Prisma.OrderWhereInput = parsed.data.status === "ALL"
    ? {
      OR: [
        { status: "COMPLETED", completedAt: terminalDateFilter },
        { status: "CANCELLED", cancelledAt: terminalDateFilter },
      ],
    }
    : parsed.data.status === "COMPLETED"
      ? { status: "COMPLETED", completedAt: terminalDateFilter }
      : { status: "CANCELLED", cancelledAt: terminalDateFilter };
  const searchFilter: Prisma.OrderWhereInput | null = parsed.data.query
    ? {
        OR: [
          { orderNo: { contains: parsed.data.query, mode: "insensitive" } },
          { customerName: { contains: parsed.data.query, mode: "insensitive" } },
          { customerPhone: { contains: parsed.data.query } },
        ],
      }
    : null;

  const orders = await prisma.order.findMany({
    where: {
      organizationId: authorization.stall.organizationId,
      stallId: authorization.stall.id,
      AND: searchFilter ? [terminalFilter, searchFilter] : [terminalFilter],
    },
    orderBy: [{ completedAt: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
    take: 100,
    select: {
      id: true,
      orderNo: true,
      customerName: true,
      customerPhone: true,
      fulfillmentType: true,
      tableLabel: true,
      status: true,
      paymentStatus: true,
      subtotal: true,
      discountAmount: true,
      discountLabel: true,
      total: true,
      note: true,
      createdAt: true,
      completedAt: true,
      cancelledAt: true,
      cancellationReason: true,
      cancellationDetail: true,
      payment: {
        select: {
          id: true,
          paymentOptionId: true,
          checkoutGroupId: true,
          method: true,
          methodLabel: true,
          status: true,
          amount: true,
          paidAt: true,
        },
      },
      items: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          quantity: true,
          unitPrice: true,
          note: true,
          noteOptions: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: { groupName: true, optionName: true, priceDelta: true },
          },
        },
      },
    },
  });
  const paymentOptions = await prisma.paymentOption.findMany({
    where: {
      organizationId: authorization.stall.organizationId,
      stallId: authorization.stall.id,
      isEnabled: true,
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, kind: true },
  });

  return NextResponse.json({
    orders: orders.map((order) => ({
      ...order,
      createdAt: order.createdAt.toISOString(),
      completedAt: order.completedAt?.toISOString() ?? null,
      cancelledAt: order.cancelledAt?.toISOString() ?? null,
      payment: order.payment ? { ...order.payment, paidAt: order.payment.paidAt.toISOString() } : null,
    })),
    paymentOptions,
  }, { headers: { "x-request-id": authorization.requestId } });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "UPDATE_ORDERS");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理頁面後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }
  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = commandSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "操作資料格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const order = await prisma.order.findFirst({
    where: {
      id: parsed.data.orderId,
      organizationId: authorization.stall.organizationId,
      stallId: authorization.stall.id,
    },
    select: {
      id: true,
      orderNo: true,
      status: true,
      paymentStatus: true,
      payment: {
        select: {
          id: true,
          checkoutGroupId: true,
          paymentOptionId: true,
          method: true,
          methodLabel: true,
          cashShiftId: true,
          amount: true,
          status: true,
        },
      },
    },
  });
  if (!order) {
    return NextResponse.json(
      { error: "找不到此訂單。" },
      { status: 404, headers: { "x-request-id": authorization.requestId } },
    );
  }
  if (order.status !== "COMPLETED") {
    return NextResponse.json(
      { error: "僅能操作仍為已完成狀態的訂單。" },
      { status: 409, headers: { "x-request-id": authorization.requestId } },
    );
  }

  try {
    await verifyManagerAuthorization({
      stallId: authorization.stall.id,
      actorProfileId: authorization.principal.user.id,
      actorRoles: authorization.roles,
      operation: parsed.data.operation,
      authorizationCode: parsed.data.managerAuthorizationCode,
    });
  } catch (error) {
    if (!(error instanceof ManagerAuthorizationError)) throw error;
    await recordAuditEvent({
      organizationId: authorization.stall.organizationId,
      stallId: authorization.stall.id,
      actorProfileId: authorization.principal.user.id,
      action: `${parsed.data.operation}_AUTHORIZATION_FAILED`,
      entityType: "ORDER",
      entityId: order.id,
      outcome: "DENIED",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      metadata: { reason: error.code },
    });
    return managerAuthorizationErrorResponse(error, authorization.requestId);
  }

  if (parsed.data.operation === "CANCEL_COMPLETED_ORDER") {
    const cancelCommand = parsed.data;
    if (cancelCommand.confirmationOrderNo !== order.orderNo) {
      return NextResponse.json(
        { error: "訂單編號確認不符，訂單未取消。" },
        { status: 400, headers: { "x-request-id": authorization.requestId } },
      );
    }
    const now = new Date();
    const changed = await prisma.$transaction(async (transaction) => {
      const result = await transaction.order.updateMany({
        where: { id: order.id, stallId: authorization.stall.id, status: "COMPLETED" },
        data: {
          status: "CANCELLED",
          cancelledAt: now,
          cancelledById: authorization.principal.user.id,
          cancellationReason: cancelCommand.cancellationReason,
          cancellationDetail: cancelCommand.cancellationDetail ?? null,
        },
      });
      if (result.count !== 1) return false;
      await transaction.orderEvent.create({
        data: {
          organizationId: authorization.stall.organizationId,
          stallId: authorization.stall.id,
          orderId: order.id,
          eventType: "COMPLETED_ORDER_CANCELLED",
          previousStatus: "COMPLETED",
          newStatus: "CANCELLED",
          createdBy: authorization.principal.user.id,
        },
      });
      return true;
    });
    if (!changed) return conflictResponse(authorization.requestId);
    await recordAuditEvent({
      organizationId: authorization.stall.organizationId,
      stallId: authorization.stall.id,
      actorProfileId: authorization.principal.user.id,
      action: "COMPLETED_ORDER_CANCELLED",
      entityType: "ORDER",
      entityId: order.id,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      before: { status: order.status, paymentStatus: order.paymentStatus },
      after: { status: "CANCELLED", paymentStatus: order.paymentStatus },
      metadata: {
        cancellationReason: cancelCommand.cancellationReason,
        paymentRequiresSeparateRefund: order.paymentStatus === "PAID",
      },
    });
    return NextResponse.json(
      { ok: true, warning: order.paymentStatus === "PAID" ? "訂單已取消；款項未自動退款，請依實際情況另行退款或對帳。" : null },
      { headers: { "x-request-id": authorization.requestId } },
    );
  }

  if (!order.payment || order.paymentStatus !== "PAID" || order.payment.status !== "PAID") {
    return NextResponse.json(
      { error: "此訂單沒有可更正的已付款紀錄。" },
      { status: 409, headers: { "x-request-id": authorization.requestId } },
    );
  }
  const paymentCommand = parsed.data;
  if (order.payment.checkoutGroupId) {
    return NextResponse.json(
      { error: "併桌結帳屬於群組付款，請從現金交班或帳務介面整組處理，避免只修改其中一張訂單。" },
      { status: 409, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const paymentOption = await prisma.paymentOption.findFirst({
    where: {
      id: paymentCommand.paymentOptionId,
      organizationId: authorization.stall.organizationId,
      stallId: authorization.stall.id,
      isEnabled: true,
    },
    select: { id: true, name: true, kind: true },
  });
  if (!paymentOption) {
    return NextResponse.json(
      { error: "付款方式已停用或不存在。" },
      { status: 409, headers: { "x-request-id": authorization.requestId } },
    );
  }
  if (order.payment.paymentOptionId === paymentOption.id) {
    return NextResponse.json(
      { error: "新的付款方式與原付款方式相同。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const now = new Date();
  const nextMethod = paymentOption.kind === "CASH" ? "CASH" : "OTHER";
  const cashClassificationChanged = (order.payment.method === "CASH") !== (nextMethod === "CASH");
  let changed: "CASH_SHIFT_REQUIRED" | "CONFLICT" | { status: "UPDATED"; cashShiftId: string | null };
  try {
    changed = await prisma.$transaction(async (transaction) => {
      let cashShiftId = order.payment!.cashShiftId;
      let adjustmentShiftId: string | null = null;
      if (cashClassificationChanged) {
        if (order.payment!.method === "CASH" && !order.payment!.cashShiftId) {
          return "CASH_SHIFT_REQUIRED" as const;
        }
        const openShift = await transaction.cashShift.findFirst({
          where: order.payment!.method === "CASH"
            ? {
                id: order.payment!.cashShiftId!,
                organizationId: authorization.stall.organizationId,
                stallId: authorization.stall.id,
                status: "OPEN",
              }
            : {
                organizationId: authorization.stall.organizationId,
                stallId: authorization.stall.id,
                status: "OPEN",
              },
          ...(order.payment!.method === "CASH" ? {} : { orderBy: { openedAt: "desc" as const } }),
          select: { id: true },
        });
        if (!openShift) return "CASH_SHIFT_REQUIRED" as const;
        adjustmentShiftId = openShift.id;
        cashShiftId = nextMethod === "CASH" ? openShift.id : null;
      } else if (nextMethod !== "CASH") {
        cashShiftId = null;
      }
      if (order.payment!.method !== nextMethod || order.payment!.cashShiftId !== cashShiftId) {
        await transaction.$executeRaw(
          Prisma.sql`select set_config('app.payment_method_correction', 'authorized', true)`,
        );
      }
      const result = await transaction.payment.updateMany({
        where: {
          id: order.payment!.id,
          orderId: order.id,
          status: "PAID",
          paymentOptionId: order.payment!.paymentOptionId,
          method: order.payment!.method,
          cashShiftId: order.payment!.cashShiftId,
        },
        data: {
          paymentOptionId: paymentOption.id,
          method: nextMethod,
          methodLabel: paymentOption.name,
          cashShiftId,
          cashReceived: paymentOption.kind === "CASH" ? order.payment!.amount : null,
          changeAmount: paymentOption.kind === "CASH" ? 0 : null,
          reconciliationStatus: "PAYMENT_METHOD_CORRECTED",
        },
      });
      if (result.count !== 1) return "CONFLICT" as const;
      const event = await transaction.orderEvent.create({
        data: {
          organizationId: authorization.stall.organizationId,
          stallId: authorization.stall.id,
          orderId: order.id,
          eventType: "COMPLETED_PAYMENT_METHOD_CHANGED",
          previousStatus: "COMPLETED",
          newStatus: "COMPLETED",
          createdBy: authorization.principal.user.id,
        },
      });
      if (cashClassificationChanged && adjustmentShiftId) {
        await transaction.cashMovement.create({
          data: {
            organizationId: authorization.stall.organizationId,
            stallId: authorization.stall.id,
            cashShiftId: adjustmentShiftId,
            type: nextMethod === "CASH" ? "CASH_IN" : "CASH_OUT",
            amount: order.payment!.amount,
            reason: `付款方式更正：${paymentCommand.reason}`,
            referenceType: "PAYMENT_METHOD_CORRECTION",
            referenceId: event.id,
            recordedById: authorization.principal.user.id,
          },
        });
      }
      return { status: "UPDATED" as const, cashShiftId };
    });
  } catch (error) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      event: "COMPLETED_PAYMENT_METHOD_CHANGE_FAILED",
      requestId: authorization.requestId,
      orderId: order.id,
      errorName: error instanceof Error ? error.name : "UnknownError",
    }));
    return NextResponse.json(
      { error: "付款方式更新失敗，請稍後再試。" },
      { status: 500, headers: { "x-request-id": authorization.requestId } },
    );
  }
  if (changed === "CASH_SHIFT_REQUIRED") {
    return NextResponse.json(
      { error: "跨現金與非現金更正前，必須先開啟現金班次；已關班的帳務請從現金交班處理。" },
      { status: 409, headers: { "x-request-id": authorization.requestId } },
    );
  }
  if (changed === "CONFLICT") return conflictResponse(authorization.requestId);

  await recordAuditEvent({
    organizationId: authorization.stall.organizationId,
    stallId: authorization.stall.id,
    actorProfileId: authorization.principal.user.id,
    action: "COMPLETED_PAYMENT_METHOD_CHANGED",
    entityType: "ORDER",
    entityId: order.id,
    outcome: "SUCCESS",
    requestId: authorization.requestId,
    ipHash: hashClientIp(request),
    before: {
      paymentOptionId: order.payment.paymentOptionId,
      method: order.payment.method,
      methodLabel: order.payment.methodLabel,
      cashShiftId: order.payment.cashShiftId,
    },
    after: {
      paymentOptionId: paymentOption.id,
      method: nextMethod,
      methodLabel: paymentOption.name,
      cashShiftId: changed.cashShiftId,
    },
    metadata: { reason: parsed.data.reason },
  });
  return NextResponse.json(
    { ok: true, payment: { paymentOptionId: paymentOption.id, methodLabel: paymentOption.name, correctedAt: now.toISOString() } },
    { headers: { "x-request-id": authorization.requestId } },
  );
}

function managerAuthorizationErrorResponse(error: ManagerAuthorizationError, requestId: string) {
  const messages: Record<ManagerAuthorizationError["code"], string> = {
    CODE_REQUIRED: "請由經理或老闆輸入管理授權碼。",
    CODE_NOT_CONFIGURED: "尚未設定管理授權碼，請先至安全與訂單限制設定。",
    INVALID_CODE: "管理授權碼不正確。",
    RATE_LIMITED: "管理授權碼嘗試過多，請稍後再試。",
  };
  return NextResponse.json(
    { error: messages[error.code], code: error.code },
    { status: error.code === "RATE_LIMITED" ? 429 : 403, headers: { "x-request-id": requestId } },
  );
}

function conflictResponse(requestId: string) {
  return NextResponse.json(
    { error: "訂單已被其他人更新，請重新查詢後再試。" },
    { status: 409, headers: { "x-request-id": requestId } },
  );
}
