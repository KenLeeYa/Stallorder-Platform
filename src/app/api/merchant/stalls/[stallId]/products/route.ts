import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeStallManagementApiRequest } from "@/lib/authorization";
import { stallProductBulkCommandSchema } from "@/lib/catalog-validation";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { hashClientIp } from "@/lib/security";
import { effectiveProductPrice } from "@/lib/shared-catalog";
import { invalidatePublicMenu } from "@/lib/public-menu";

type RouteContext = { params: Promise<{ stallId: string }> };
class StallCatalogConflict extends Error {}

export async function PATCH(request: Request, context: RouteContext) {
  const { stallId } = await context.params;
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
  const parsed = stallProductBulkCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "批次商品設定格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const organizationId = authorization.workspace.id;
  const command = parsed.data;
  try {
    const changedCount = await prisma.$transaction(async (transaction) => {
      if (command.operation === "BULK_SOLD_OUT") {
        const ownedCount = await transaction.stallProduct.count({
          where: { stallId, organizationId, productId: { in: command.productIds } },
        });
        if (ownedCount !== command.productIds.length) throw new StallCatalogConflict("NOT_FOUND");
        const changed = await transaction.stallProduct.updateMany({
          where: { stallId, organizationId, productId: { in: command.productIds } },
          data: { isSoldOut: command.isSoldOut },
        });
        return changed.count;
      }

      if (command.sourceStallId === stallId) throw new StallCatalogConflict("SAME_STALL");
      const authorizedSource = authorization.workspace.stalls.some((stall) => stall.id === command.sourceStallId);
      if (!authorizedSource) throw new StallCatalogConflict("SOURCE_DENIED");
      const source = await transaction.stall.findFirst({
        where: { id: command.sourceStallId, organizationId },
        select: { id: true },
      });
      if (!source) throw new StallCatalogConflict("SOURCE_DENIED");
      const assignments = await transaction.stallProduct.findMany({
        where: { stallId: source.id, organizationId },
      });
      for (const assignment of assignments) {
        await transaction.stallProduct.upsert({
          where: { stallId_productId: { stallId, productId: assignment.productId } },
          create: {
            organizationId,
            stallId,
            productId: assignment.productId,
            priceOverride: assignment.priceOverride,
            isEnabled: assignment.isEnabled,
            isSoldOut: assignment.isSoldOut,
            sortOrder: assignment.sortOrder,
            availableFrom: assignment.availableFrom,
            availableUntil: assignment.availableUntil,
          },
          update: {
            priceOverride: assignment.priceOverride,
            isEnabled: assignment.isEnabled,
            isSoldOut: assignment.isSoldOut,
            sortOrder: assignment.sortOrder,
            availableFrom: assignment.availableFrom,
            availableUntil: assignment.availableUntil,
          },
        });
      }
      return assignments.length;
    });

    await recordAuditEvent({
      organizationId,
      stallId,
      actorProfileId: authorization.principal.user.id,
      action: command.operation === "BULK_SOLD_OUT" ? "STALL_PRODUCTS_BULK_SOLD_OUT_CHANGED" : "STALL_CATALOG_COPIED",
      entityType: "STALL_CATALOG",
      entityId: stallId,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      metadata: {
        changedCount,
        ...(command.operation === "BULK_SOLD_OUT"
          ? { isSoldOut: command.isSoldOut }
          : { sourceStallId: command.sourceStallId }),
      },
    });
    invalidatePublicMenu(stallId);
    return NextResponse.json(
      { changedCount, products: await getStallProducts(stallId, organizationId) },
      { headers: { "x-request-id": authorization.requestId } },
    );
  } catch (error) {
    if (!(error instanceof StallCatalogConflict)) throw error;
    const denied = error.message === "SOURCE_DENIED";
    return NextResponse.json(
      { error: denied ? "無權讀取來源攤位商品。" : error.message === "SAME_STALL" ? "來源攤位不可與目前攤位相同。" : "部分商品不存在或不屬於此攤位。" },
      { status: denied ? 403 : error.message === "NOT_FOUND" ? 404 : 409, headers: { "x-request-id": authorization.requestId } },
    );
  }
}

async function getStallProducts(stallId: string, organizationId: string) {
  const products = await prisma.stallProduct.findMany({
    where: { stallId, organizationId },
    orderBy: [{ sortOrder: "asc" }, { product: { name: "asc" } }],
    include: {
      product: {
        include: {
          category: { select: { name: true } },
          group: { select: { name: true } },
        },
      },
    },
  });
  return products.map((assignment) => ({
    id: assignment.id,
    productId: assignment.productId,
    categoryName: assignment.product.category.name,
    groupName: assignment.product.group?.name ?? null,
    name: assignment.product.name,
    description: assignment.product.description,
    defaultPrice: assignment.product.defaultPrice,
    priceOverride: assignment.priceOverride,
    effectivePrice: effectiveProductPrice(assignment.product.defaultPrice, assignment.priceOverride),
    isEnabled: assignment.isEnabled,
    isSoldOut: assignment.isSoldOut,
    sortOrder: assignment.sortOrder,
    availableFrom: assignment.availableFrom,
    availableUntil: assignment.availableUntil,
    masterIsActive: assignment.product.isActive,
  }));
}
