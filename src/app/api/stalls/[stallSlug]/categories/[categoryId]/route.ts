import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeCatalogMutation } from "@/lib/catalog-api";
import { categoryUpdateSchema } from "@/lib/catalog-validation";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { hashClientIp } from "@/lib/security";

type RouteContext = { params: Promise<{ stallSlug: string; categoryId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { stallSlug, categoryId } = await context.params;
  const authorization = await authorizeCatalogMutation(
    request,
    stallSlug,
    "PRODUCT_CATEGORY",
    categoryId,
  );
  if (!authorization.ok) return authorization.response;

  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = categoryUpdateSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "分類資料格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const existing = await prisma.productCategory.findFirst({
    where: { id: categoryId, stallId: authorization.stall.id },
  });
  if (!existing) {
    return NextResponse.json(
      { error: "找不到此分類。" },
      { status: 404, headers: { "x-request-id": authorization.requestId } },
    );
  }

  try {
    const category = await prisma.productCategory.update({
      where: { id: existing.id },
      data: parsed.data,
    });
    await recordAuditEvent({
      action: "PRODUCT_CATEGORY_UPDATED",
      entityType: "PRODUCT_CATEGORY",
      entityId: category.id,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      stallId: authorization.stall.id,
      actorUserId: authorization.principal.user.id,
      ipHash: hashClientIp(request),
    });
    return NextResponse.json(
      { category },
      { headers: { "x-request-id": authorization.requestId } },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "此分類名稱已存在。" },
        { status: 409, headers: { "x-request-id": authorization.requestId } },
      );
    }
    throw error;
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const { stallSlug, categoryId } = await context.params;
  const authorization = await authorizeCatalogMutation(
    request,
    stallSlug,
    "PRODUCT_CATEGORY",
    categoryId,
  );
  if (!authorization.ok) return authorization.response;

  const category = await prisma.productCategory.findFirst({
    where: { id: categoryId, stallId: authorization.stall.id },
    select: { id: true },
  });
  if (!category) {
    return NextResponse.json(
      { error: "找不到此分類。" },
      { status: 404, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const productCount = await prisma.product.count({ where: { categoryId: category.id } });
  if (productCount > 0) {
    return NextResponse.json(
      { error: "此分類仍有商品，請先移動或刪除商品。" },
      { status: 409, headers: { "x-request-id": authorization.requestId } },
    );
  }

  try {
    await prisma.productCategory.delete({ where: { id: category.id } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return NextResponse.json(
        { error: "此分類目前無法刪除。" },
        { status: 409, headers: { "x-request-id": authorization.requestId } },
      );
    }
    throw error;
  }

  await recordAuditEvent({
    action: "PRODUCT_CATEGORY_DELETED",
    entityType: "PRODUCT_CATEGORY",
    entityId: category.id,
    outcome: "SUCCESS",
    requestId: authorization.requestId,
    stallId: authorization.stall.id,
    actorUserId: authorization.principal.user.id,
    ipHash: hashClientIp(request),
  });
  return new Response(null, {
    status: 204,
    headers: { "x-request-id": authorization.requestId },
  });
}
