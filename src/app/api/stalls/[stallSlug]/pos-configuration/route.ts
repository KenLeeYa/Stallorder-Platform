import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/rbac";
import { getStaffOrderPageConfiguration } from "@/lib/staff-order-catalog";

type RouteContext = { params: Promise<{ stallSlug: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "VIEW_ORDERS");
  if (!authorization.ok) return authorization.response;

  const includeCatalog = new URL(request.url).searchParams.get("includeCatalog") === "true"
    && authorization.roles.some((role) => hasPermission(role, "CREATE_ORDERS"));
  const [configuration, paymentOptions, discountOptions] = await Promise.all([
    getStaffOrderPageConfiguration(
      authorization.stall.id,
      authorization.stall.organizationId,
      includeCatalog,
    ),
    prisma.paymentOption.findMany({
      where: {
        stallId: authorization.stall.id,
        organizationId: authorization.stall.organizationId,
        isEnabled: true,
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, kind: true },
    }),
    prisma.discountOption.findMany({
      where: {
        stallId: authorization.stall.id,
        organizationId: authorization.stall.organizationId,
        isEnabled: true,
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, rateBps: true },
    }),
  ]);

  return NextResponse.json(
    {
      modules: configuration.modules,
      catalog: configuration.catalog,
      paymentOptions,
      discountOptions,
    },
    { headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } },
  );
}
