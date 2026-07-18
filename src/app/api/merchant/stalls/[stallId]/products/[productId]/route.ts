import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeStallManagementApiRequest } from "@/lib/authorization";
import { stallProductSettingsSchema } from "@/lib/catalog-validation";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { hashClientIp } from "@/lib/security";
import { effectiveProductPrice } from "@/lib/shared-catalog";
import { invalidatePublicMenu } from "@/lib/public-menu";

type RouteContext = { params: Promise<{ stallId: string; productId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { stallId, productId } = await context.params;
  const authorization = await authorizeStallManagementApiRequest(request, stallId, "MANAGE_PRODUCTS");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = stallProductSettingsSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "攤位商品設定格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const existing = await prisma.stallProduct.findFirst({
    where: {
      stallId,
      productId,
      organizationId: authorization.workspace.id,
      product: { organizationId: authorization.workspace.id },
    },
    include: { product: { select: { defaultPrice: true } } },
  });
  if (!existing) {
    return NextResponse.json(
      { error: "找不到此攤位商品。" },
      { status: 404, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const stallProduct = await prisma.stallProduct.update({
    where: { id: existing.id },
    data: parsed.data,
    select: {
      id: true,
      stallId: true,
      productId: true,
      priceOverride: true,
      isEnabled: true,
      isSoldOut: true,
      sortOrder: true,
      availableFrom: true,
      availableUntil: true,
      product: { select: { defaultPrice: true } },
    },
  });

  await recordAuditEvent({
    organizationId: authorization.workspace.id,
    stallId,
    actorProfileId: authorization.principal.user.id,
    action: existing.isSoldOut !== stallProduct.isSoldOut
      ? "PRODUCT_SOLD_OUT_CHANGED"
      : existing.priceOverride !== stallProduct.priceOverride
        ? "STALL_PRODUCT_PRICE_CHANGED"
        : "STALL_PRODUCT_SETTINGS_CHANGED",
    entityType: "STALL_PRODUCT",
    entityId: stallProduct.id,
    outcome: "SUCCESS",
    requestId: authorization.requestId,
    ipHash: hashClientIp(request),
    before: {
      isEnabled: existing.isEnabled,
      isSoldOut: existing.isSoldOut,
      priceOverride: existing.priceOverride,
      sortOrder: existing.sortOrder,
      availableFrom: existing.availableFrom,
      availableUntil: existing.availableUntil,
    },
    after: {
      isEnabled: stallProduct.isEnabled,
      isSoldOut: stallProduct.isSoldOut,
      priceOverride: stallProduct.priceOverride,
      sortOrder: stallProduct.sortOrder,
      availableFrom: stallProduct.availableFrom,
      availableUntil: stallProduct.availableUntil,
    },
    metadata: {
      isEnabled: stallProduct.isEnabled,
      isSoldOut: stallProduct.isSoldOut,
      effectivePrice: effectiveProductPrice(
        stallProduct.product.defaultPrice,
        stallProduct.priceOverride,
      ),
    },
  });
  invalidatePublicMenu(stallId);

  return NextResponse.json(
    {
      stallProduct: {
        ...stallProduct,
        effectivePrice: effectiveProductPrice(
          stallProduct.product.defaultPrice,
          stallProduct.priceOverride,
        ),
      },
    },
    { headers: { "x-request-id": authorization.requestId } },
  );
}
