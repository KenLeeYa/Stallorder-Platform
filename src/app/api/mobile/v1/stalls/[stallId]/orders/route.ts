import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import {
  mobileOrderListResponseSchema,
  mobileOrdersQuerySchema,
} from "@stallorder/contracts/mobile/v1";
import { activeOrderStatuses } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { authorizeMobileStallRequest } from "@/server/mobile/authorization";
import { decodeMobileOrderCursor, encodeMobileOrderCursor } from "@/server/mobile/order-cursor";
import {
  mobileOrderSummarySelect,
  serializeMobileOrderSummary,
} from "@/server/mobile/order-read-model";

type RouteContext = { params: Promise<{ stallId: string }> };
const allowedQueryKeys = new Set(["status", "query", "cursor", "limit"]);

export async function GET(request: Request, context: RouteContext) {
  const { stallId } = await context.params;
  const authorization = await authorizeMobileStallRequest(request, stallId, "VIEW_ORDERS");
  if (!authorization.ok) return authorization.response;

  const url = new URL(request.url);
  if ([...url.searchParams.keys()].some((key) => !allowedQueryKeys.has(key))) {
    return NextResponse.json(
      { code: "INVALID_QUERY", message: "訂單查詢參數不正確。", requestId: authorization.requestId },
      { status: 400, headers: { "cache-control": "private, no-store", "x-request-id": authorization.requestId } },
    );
  }
  const parsed = mobileOrdersQuerySchema.safeParse({
    statuses: url.searchParams.getAll("status").length > 0
      ? url.searchParams.getAll("status")
      : [...activeOrderStatuses],
    query: url.searchParams.get("query") || undefined,
    cursor: url.searchParams.get("cursor") || undefined,
    limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : 30,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { code: "INVALID_QUERY", message: "訂單查詢參數不正確。", requestId: authorization.requestId },
      { status: 400, headers: { "cache-control": "private, no-store", "x-request-id": authorization.requestId } },
    );
  }

  const cursor = parsed.data.cursor ? decodeMobileOrderCursor(parsed.data.cursor) : null;
  if (parsed.data.cursor && !cursor) {
    return NextResponse.json(
      { code: "INVALID_CURSOR", message: "訂單分頁資料已失效，請重新整理。", requestId: authorization.requestId },
      { status: 400, headers: { "cache-control": "private, no-store", "x-request-id": authorization.requestId } },
    );
  }

  const filters: Prisma.OrderWhereInput[] = [];
  if (parsed.data.query) {
    filters.push({
      OR: [
        { orderNo: { contains: parsed.data.query, mode: "insensitive" } },
        { customerName: { contains: parsed.data.query, mode: "insensitive" } },
      ],
    });
  }
  if (cursor) {
    filters.push({
      OR: [
        { updatedAt: { lt: cursor.updatedAt } },
        { updatedAt: cursor.updatedAt, id: { lt: cursor.id } },
      ],
    });
  }

  const orders = await prisma.order.findMany({
    where: {
      stallId: authorization.stall.id,
      status: { in: parsed.data.statuses },
      ...(filters.length > 0 ? { AND: filters } : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: parsed.data.limit + 1,
    select: mobileOrderSummarySelect,
  });
  const page = orders.slice(0, parsed.data.limit);
  const last = page.at(-1);
  const response = mobileOrderListResponseSchema.parse({
    version: "v1",
    generatedAt: new Date().toISOString(),
    stallId: authorization.stall.id,
    orders: page.map(serializeMobileOrderSummary),
    nextCursor: orders.length > parsed.data.limit && last
      ? encodeMobileOrderCursor({ id: last.id, updatedAt: last.updatedAt })
      : null,
  });
  return NextResponse.json(response, {
    headers: { "cache-control": "private, no-store", "x-request-id": authorization.requestId },
  });
}
