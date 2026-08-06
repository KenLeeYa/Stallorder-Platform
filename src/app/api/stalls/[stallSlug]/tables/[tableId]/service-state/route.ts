import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { hashClientIp } from "@/lib/security";

const schema = z.object({
  serviceState: z.enum(["EMPTY", "NEEDS_CLEANING"]),
}).strict();

type RouteContext = { params: Promise<{ stallSlug: string; tableId: string }> };
class TableStateConflict extends Error {}

export async function PATCH(request: Request, context: RouteContext) {
  const { stallSlug, tableId } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "UPDATE_ORDERS");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }
  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "桌位狀態格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  try {
    const result = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`select id from public.dining_tables where id = ${tableId}::uuid for update`;
      const table = await transaction.diningTable.findFirst({
        where: { id: tableId, stallId: authorization.stall.id, organizationId: authorization.stall.organizationId },
      });
      if (!table) throw new TableStateConflict("NOT_FOUND");
      const activeOrders = await transaction.order.count({
        where: {
          diningTableId: table.id,
          status: { in: ["WAITING_CONFIRMATION", "CONFIRMED", "PREPARING", "PACKING", "READY"] },
        },
      });
      if (activeOrders > 0) throw new TableStateConflict("ACTIVE_ORDERS");
      const updated = await transaction.diningTable.update({
        where: { id: table.id },
        data: {
          serviceState: parsed.data.serviceState,
          seatedAt: parsed.data.serviceState === "EMPTY" ? null : table.seatedAt,
          cleanedAt: parsed.data.serviceState === "EMPTY" ? new Date() : table.cleanedAt,
        },
        select: {
          id: true,
          floorId: true,
          code: true,
          label: true,
          isActive: true,
          layoutX: true,
          layoutY: true,
          shape: true,
          rotationDegrees: true,
          serviceState: true,
          seatedAt: true,
          cleanedAt: true,
        },
      });
      return { before: table.serviceState, table: updated };
    });

    await recordAuditEvent({
      organizationId: authorization.stall.organizationId,
      stallId: authorization.stall.id,
      actorProfileId: authorization.principal.user.id,
      action: parsed.data.serviceState === "EMPTY" ? "DINING_TABLE_CLEANED" : "DINING_TABLE_MARKED_FOR_CLEANING",
      entityType: "DINING_TABLE",
      entityId: tableId,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      before: { serviceState: result.before },
      after: { serviceState: result.table.serviceState },
    });
    return NextResponse.json({ table: result.table }, { headers: { "x-request-id": authorization.requestId } });
  } catch (error) {
    if (!(error instanceof TableStateConflict)) throw error;
    return NextResponse.json(
      { error: error.message === "NOT_FOUND" ? "找不到此桌位。" : "此桌仍有進行中訂單，無法變更為空桌或待清潔。" },
      { status: error.message === "NOT_FOUND" ? 404 : 409, headers: { "x-request-id": authorization.requestId } },
    );
  }
}
