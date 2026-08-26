import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { hashClientIp } from "@/lib/security";
import { authorizePublicApiRequest } from "@/server/developer-platform/public-api-auth";

const API_VERSION = "2026-08-26";
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid().nullable().default(null),
}).strict();

type RouteContext = { params: Promise<{ organizationId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizePublicApiRequest(request, {
    organizationId,
    requiredScope: "catalog:read",
  });
  if (!authorization.ok) return authorization.response;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    cursor: url.searchParams.get("cursor"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_QUERY", message: "limit 或 cursor 格式不正確。" } },
      { status: 400, headers: responseHeaders(authorization.requestId) },
    );
  }

  const rows = await prisma.product.findMany({
    where: {
      organizationId,
      isActive: true,
      ...(parsed.data.cursor ? { id: { gt: parsed.data.cursor } } : {}),
    },
    select: {
      id: true,
      name: true,
      description: true,
      kind: true,
      defaultPrice: true,
      updatedAt: true,
    },
    orderBy: { id: "asc" },
    take: parsed.data.limit + 1,
  });
  const hasMore = rows.length > parsed.data.limit;
  const page = hasMore ? rows.slice(0, parsed.data.limit) : rows;
  await recordAuditEvent({
    organizationId,
    action: "PUBLIC_API_CATALOG_READ",
    entityType: "PUBLIC_API_CLIENT",
    entityId: authorization.client.id,
    outcome: "SUCCESS",
    requestId: authorization.requestId,
    ipHash: hashClientIp(request),
    metadata: { apiVersion: API_VERSION, itemCount: page.length },
  });
  return NextResponse.json(
    {
      data: page.map((product) => ({
        id: product.id,
        name: product.name,
        description: product.description,
        kind: product.kind,
        price: { amount: product.defaultPrice, currency: "TWD" },
        updatedAt: product.updatedAt.toISOString(),
      })),
      meta: {
        apiVersion: API_VERSION,
        nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
      },
    },
    { headers: responseHeaders(authorization.requestId) },
  );
}

function responseHeaders(requestId: string) {
  return {
    "cache-control": "private, no-store",
    "content-type": "application/json; charset=utf-8",
    "x-request-id": requestId,
    "x-stallorder-api-version": API_VERSION,
  };
}
