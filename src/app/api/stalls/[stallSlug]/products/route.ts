import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeCatalogMutation } from "@/lib/catalog-api";
import { productInputSchema } from "@/lib/catalog-validation";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { hashClientIp } from "@/lib/security";

type RouteContext = { params: Promise<{ stallSlug: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
  const authorization = await authorizeCatalogMutation(request, stallSlug, "PRODUCT");
  if (!authorization.ok) return authorization.response;

  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = productInputSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "商品資料格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const category = await prisma.productCategory.findFirst({
    where: { id: parsed.data.categoryId, organizationId: authorization.stall.organizationId },
    select: { id: true },
  });
  if (!category) {
    return NextResponse.json(
      { error: "找不到指定分類。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const product = await prisma.$transaction(async (transaction) => {
    const master = await transaction.product.create({
      data: {
        organizationId: authorization.stall.organizationId,
        categoryId: parsed.data.categoryId,
        name: parsed.data.name,
        description: parsed.data.description,
        defaultPrice: parsed.data.price,
        sortOrder: parsed.data.sortOrder,
      },
    });
    await transaction.stallProduct.create({
      data: {
        organizationId: authorization.stall.organizationId,
        stallId: authorization.stall.id,
        productId: master.id,
        isEnabled: true,
        isSoldOut: !parsed.data.isAvailable,
        sortOrder: parsed.data.sortOrder,
      },
    });
    return master;
  });
  await recordAuditEvent({
    action: "PRODUCT_CREATED",
    entityType: "PRODUCT",
    entityId: product.id,
    outcome: "SUCCESS",
    requestId: authorization.requestId,
    stallId: authorization.stall.id,
    actorProfileId: authorization.principal.user.id,
    ipHash: hashClientIp(request),
    metadata: { categoryId: product.categoryId, price: product.defaultPrice },
  });

  return NextResponse.json(
    { product: { ...product, price: product.defaultPrice, isAvailable: parsed.data.isAvailable } },
    { status: 201, headers: { "x-request-id": authorization.requestId } },
  );
}
