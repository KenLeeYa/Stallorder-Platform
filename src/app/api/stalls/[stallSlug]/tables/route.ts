import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ stallSlug: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "VIEW_DINING_FLOOR");
  if (!authorization.ok) return authorization.response;

  const [floors, tables] = await Promise.all([
    prisma.diningFloor.findMany({
      where: { stallId: authorization.stall.id, organizationId: authorization.stall.organizationId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, sortOrder: true },
    }),
    prisma.diningTable.findMany({
      where: { stallId: authorization.stall.id, organizationId: authorization.stall.organizationId },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
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
    }),
  ]);
  return NextResponse.json({ floors, tables }, {
    headers: { "cache-control": "no-store", "x-request-id": authorization.requestId },
  });
}
