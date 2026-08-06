import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import {
  fulfillmentTimeCommandSchema,
  isUninitializedLegacyQrTakeout,
} from "@/lib/fulfillment-time";
import { readJson } from "@/lib/http";
import { serializeStaffOrder, staffOrderSelect } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { hashClientIp } from "@/lib/security";

type RouteContext = { params: Promise<{ stallSlug: string; orderId: string }> };

class FulfillmentTimeError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "CONFLICT" | "UNAVAILABLE" | "INVALID_TIME",
  ) {
    super(code);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { stallSlug, orderId } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "UPDATE_ORDERS");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const body = await readJson(request, authorization.requestId, { maxBytes: 4_000 });
  if (body.error) return body.error;
  const parsed = fulfillmentTimeCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "時間調整資料格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  try {
    const result = await prisma.$transaction(async (transaction) => {
      const current = await transaction.order.findFirst({
        where: { id: orderId, stallId: authorization.stall.id },
        select: staffOrderSelect,
      });
      if (!current) throw new FulfillmentTimeError("NOT_FOUND");
      if (
        current.fulfillmentType === "DINE_IN"
        || !["WAITING_CONFIRMATION", "CONFIRMED"].includes(current.status)
      ) throw new FulfillmentTimeError("UNAVAILABLE");
      if (current.fulfillmentTimeVersion !== parsed.data.version) {
        throw new FulfillmentTimeError("CONFLICT");
      }
      if (
        parsed.data.operation === "PROPOSE"
        && parsed.data.version === 0
        && !isUninitializedLegacyQrTakeout(current)
      ) {
        throw new FulfillmentTimeError("CONFLICT");
      }

      if (parsed.data.operation === "CONFIRM_REQUESTED") {
        if (current.fulfillmentTimeState !== "REQUESTED" || !current.requestedFulfillmentAt) {
          throw new FulfillmentTimeError("CONFLICT");
        }
        const updated = await transaction.order.updateMany({
          where: {
            id: current.id,
            stallId: authorization.stall.id,
            fulfillmentTimeVersion: parsed.data.version,
            fulfillmentTimeState: "REQUESTED",
          },
          data: {
            committedFulfillmentAt: current.requestedFulfillmentAt,
            pendingFulfillmentAt: null,
            fulfillmentTimeState: "CONFIRMED",
            fulfillmentTimeResponseExpiresAt: null,
            fulfillmentTimeChangeReason: null,
            fulfillmentTimeProposedById: null,
            customerTimeRespondedAt: null,
          },
        });
        if (updated.count !== 1) throw new FulfillmentTimeError("CONFLICT");
        await transaction.orderEvent.create({
          data: {
            organizationId: authorization.stall.organizationId,
            stallId: authorization.stall.id,
            orderId: current.id,
            eventType: "FULFILLMENT_TIME_CONFIRMED_BY_STAFF",
            createdBy: authorization.principal.user.id,
            metadataJson: {
              version: parsed.data.version,
              committedFulfillmentAt: current.requestedFulfillmentAt.toISOString(),
            },
          },
        });
      } else {
        const proposedAt = new Date(parsed.data.proposedFulfillmentAt);
        const [validation] = await transaction.$queryRaw<Array<{ code: string | null }>>`
          select public.validate_requested_fulfillment_slot(
            ${authorization.stall.id}::uuid,
            ${current.fulfillmentType}::public.fulfillment_type,
            'EXISTING_ORDER',
            ${proposedAt}::timestamptz,
            now()
          ) as code
        `;
        if (!validation || validation.code !== null) {
          throw new FulfillmentTimeError("INVALID_TIME");
        }
        const now = new Date();
        const expiresAt = new Date(Math.min(
          now.getTime() + 30 * 60_000,
          proposedAt.getTime() - 5 * 60_000,
        ));
        if (expiresAt.getTime() <= now.getTime()) {
          throw new FulfillmentTimeError("INVALID_TIME");
        }
        const nextVersion = current.fulfillmentTimeVersion + 1;
        const updated = await transaction.order.updateMany({
          where: {
            id: current.id,
            stallId: authorization.stall.id,
            fulfillmentTimeVersion: current.fulfillmentTimeVersion,
          },
          data: {
            pendingFulfillmentAt: proposedAt,
            fulfillmentTimeState: "CUSTOMER_ACTION_REQUIRED",
            fulfillmentTimeVersion: nextVersion,
            fulfillmentTimeResponseExpiresAt: expiresAt,
            fulfillmentTimeChangeReason: parsed.data.reason,
            fulfillmentTimeProposedById: authorization.principal.user.id,
            customerTimeRespondedAt: null,
          },
        });
        if (updated.count !== 1) throw new FulfillmentTimeError("CONFLICT");
        await transaction.orderEvent.create({
          data: {
            organizationId: authorization.stall.organizationId,
            stallId: authorization.stall.id,
            orderId: current.id,
            eventType: "FULFILLMENT_TIME_PROPOSED",
            createdBy: authorization.principal.user.id,
            metadataJson: {
              previousVersion: current.fulfillmentTimeVersion,
              version: nextVersion,
              requestedFulfillmentAt: current.requestedFulfillmentAt?.toISOString() ?? null,
              committedFulfillmentAt: current.committedFulfillmentAt?.toISOString() ?? null,
              proposedFulfillmentAt: proposedAt.toISOString(),
              responseExpiresAt: expiresAt.toISOString(),
              reason: parsed.data.reason,
            },
          },
        });
      }

      const updatedOrder = await transaction.order.findUnique({
        where: { id: current.id },
        select: staffOrderSelect,
      });
      if (!updatedOrder) throw new FulfillmentTimeError("NOT_FOUND");
      return { before: current, order: updatedOrder };
    });

    await recordAuditEvent({
      organizationId: authorization.stall.organizationId,
      stallId: authorization.stall.id,
      actorProfileId: authorization.principal.user.id,
      action: parsed.data.operation === "PROPOSE"
        ? "FULFILLMENT_TIME_PROPOSED"
        : "FULFILLMENT_TIME_CONFIRMED_BY_STAFF",
      entityType: "ORDER",
      entityId: result.order.id,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      before: {
        state: result.before.fulfillmentTimeState,
        version: result.before.fulfillmentTimeVersion,
      },
      after: {
        state: result.order.fulfillmentTimeState,
        version: result.order.fulfillmentTimeVersion,
      },
    });

    return NextResponse.json(
      { order: serializeStaffOrder(result.order) },
      { headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } },
    );
  } catch (error) {
    if (error instanceof FulfillmentTimeError) {
      const details = {
        NOT_FOUND: { status: 404, message: "找不到此訂單。" },
        CONFLICT: { status: 409, message: "此訂單的時間狀態已更新，請重新整理後再試。" },
        UNAVAILABLE: { status: 409, message: "目前訂單狀態不允許調整取餐或送達時間。" },
        INVALID_TIME: { status: 400, message: "所選時間已失效或不在可預約時段內。" },
      }[error.code];
      return NextResponse.json(
        { error: details.message, code: error.code },
        { status: details.status, headers: { "x-request-id": authorization.requestId } },
      );
    }
    return NextResponse.json(
      { error: "目前無法更新取餐或送達時間，請稍後再試。" },
      { status: 500, headers: { "x-request-id": authorization.requestId } },
    );
  }
}
