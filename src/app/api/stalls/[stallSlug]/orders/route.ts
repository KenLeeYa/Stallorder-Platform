import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/authorization";
import { activeOrderStatuses } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ stallSlug: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "VIEW_ORDERS");
  if (!authorization.ok) return authorization.response;

  await prisma.$queryRaw`select public.expire_unconfirmed_orders()`;
  const statuses = authorization.role === "KITCHEN"
    ? activeOrderStatuses.filter((status) => status !== "WAITING_CONFIRMATION")
    : activeOrderStatuses;
  const orders = await prisma.order.findMany({
    where: { stallId: authorization.stall.id, status: { in: [...statuses] } },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: {
      id: true,
      orderNo: true,
      source: true,
      customerName: true,
      tableLabel: true,
      note: true,
      status: true,
      paymentStatus: true,
      total: true,
      pickupVerifiedAt: true,
      confirmationExpiresAt: true,
      createdAt: true,
      items: { select: { id: true, name: true, unitPrice: true, quantity: true } },
    },
  });

  return NextResponse.json(
    { orders },
    { headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } },
  );
}

export async function POST() {
  return NextResponse.json(
    {
      error: "公開訂單只能透過 QR Code 安全點餐流程建立。",
      code: "EDGE_FUNCTION_REQUIRED",
    },
    { status: 405, headers: { Allow: "GET", "cache-control": "no-store" } },
  );
}
