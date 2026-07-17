import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ stallSlug: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "VIEW_DINING_FLOOR");
  if (!authorization.ok) return authorization.response;

  const tables = await prisma.diningTable.findMany({
    where: { stallId: authorization.stall.id, organizationId: authorization.stall.organizationId },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    select: {
      id: true,
      code: true,
      label: true,
      isActive: true,
      layoutX: true,
      layoutY: true,
      serviceState: true,
      seatedAt: true,
      cleanedAt: true,
    },
  });
  return NextResponse.json({ tables }, {
    headers: { "cache-control": "no-store", "x-request-id": authorization.requestId },
  });
}
