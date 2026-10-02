import { NextResponse } from "next/server";
import { mobileOrderDetailResponseSchema } from "@stallorder/contracts/mobile/v1";
import { prisma } from "@/lib/prisma";
import { authorizeMobileStallRequest } from "@/server/mobile/authorization";
import {
  mobileOrderDetailSelect,
  serializeMobileOrderDetail,
} from "@/server/mobile/order-read-model";

type RouteContext = { params: Promise<{ stallId: string; orderId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { stallId, orderId } = await context.params;
  const authorization = await authorizeMobileStallRequest(request, stallId, "VIEW_ORDERS");
  if (!authorization.ok) return authorization.response;

  const order = await prisma.order.findFirst({
    where: { id: orderId, stallId: authorization.stall.id },
    select: mobileOrderDetailSelect,
  });
  if (!order) {
    return NextResponse.json(
      { code: "ORDER_NOT_FOUND", message: "找不到此訂單。", requestId: authorization.requestId },
      { status: 404, headers: { "cache-control": "private, no-store", "x-request-id": authorization.requestId } },
    );
  }

  const response = mobileOrderDetailResponseSchema.parse({
    version: "v1",
    generatedAt: new Date().toISOString(),
    stallId: authorization.stall.id,
    order: serializeMobileOrderDetail(order),
  });
  return NextResponse.json(response, {
    headers: { "cache-control": "private, no-store", "x-request-id": authorization.requestId },
  });
}
