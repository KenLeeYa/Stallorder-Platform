import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeCatalogMutation } from "@/lib/catalog-api";
import { productUpdateSchema } from "@/lib/catalog-validation";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { hashClientIp } from "@/lib/security";

type RouteContext = { params: Promise<{ stallSlug: string; productId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { stallSlug, productId } = await context.params;
  const authorization = await authorizeCatalogMutation(request, stallSlug, "PRODUCT", productId);
  if (!authorization.ok) return authorization.response;

  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = productUpdateSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "商品資料格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const product = await prisma.product.findFirst({
    where: { id: productId, stallId: authorization.stall.id },
  });
  if (!product) {
    return NextResponse.json(
      { error: "找不到此商品。" },
      { status: 404, headers: { "x-request-id": authorization.requestId } },
    );
  }

  if (parsed.data.categoryId) {
    const category = await prisma.productCategory.findFirst({
      where: { id: parsed.data.categoryId, stallId: authorization.stall.id },
      select: { id: true },
    });
    if (!category) {
      return NextResponse.json(
        { error: "找不到指定分類。" },
        { status: 400, headers: { "x-request-id": authorization.requestId } },
      );
    }
  }

  const updatedProduct = await prisma.product.update({
    where: { id: product.id },
    data: parsed.data,
  });
  const changedFields = Object.keys(parsed.data);
  const availabilityOnly = changedFields.length === 1 && changedFields[0] === "isAvailable";
  await recordAuditEvent({
    action: availabilityOnly ? "PRODUCT_AVAILABILITY_CHANGED" : "PRODUCT_UPDATED",
    entityType: "PRODUCT",
    entityId: product.id,
    outcome: "SUCCESS",
    requestId: authorization.requestId,
    stallId: authorization.stall.id,
    actorProfileId: authorization.principal.user.id,
    ipHash: hashClientIp(request),
    metadata: {
      changedFieldCount: changedFields.length,
      isAvailable: updatedProduct.isAvailable,
    },
  });

  return NextResponse.json(
    { product: updatedProduct },
    { headers: { "x-request-id": authorization.requestId } },
  );
}

export async function DELETE(request: Request, context: RouteContext) {
  const { stallSlug, productId } = await context.params;
  const authorization = await authorizeCatalogMutation(request, stallSlug, "PRODUCT", productId);
  if (!authorization.ok) return authorization.response;

  const product = await prisma.product.findFirst({
    where: { id: productId, stallId: authorization.stall.id },
    select: { id: true },
  });
  if (!product) {
    return NextResponse.json(
      { error: "找不到此商品。" },
      { status: 404, headers: { "x-request-id": authorization.requestId } },
    );
  }

  await prisma.product.delete({ where: { id: product.id } });
  await recordAuditEvent({
    action: "PRODUCT_DELETED",
    entityType: "PRODUCT",
    entityId: product.id,
    outcome: "SUCCESS",
    requestId: authorization.requestId,
    stallId: authorization.stall.id,
    actorProfileId: authorization.principal.user.id,
    ipHash: hashClientIp(request),
  });

  return new Response(null, {
    status: 204,
    headers: { "x-request-id": authorization.requestId },
  });
}
