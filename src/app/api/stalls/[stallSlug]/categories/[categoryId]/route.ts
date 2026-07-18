import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeCatalogMutation } from "@/lib/catalog-api";
import { categoryUpdateSchema } from "@/lib/catalog-validation";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { invalidateOrganizationPublicMenus } from "@/lib/public-menu";
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
    where: { id: categoryId, organizationId: authorization.stall.organizationId },
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
      actorProfileId: authorization.principal.user.id,
      ipHash: hashClientIp(request),
    });
    await invalidateOrganizationPublicMenus(authorization.stall.organizationId);
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
    where: { id: categoryId, organizationId: authorization.stall.organizationId },
    select: { id: true },
  });
  if (!category) {
    return NextResponse.json(
      { error: "找不到此分類。" },
      { status: 404, headers: { "x-request-id": authorization.requestId } },
    );
  }

  await prisma.productCategory.update({ where: { id: category.id }, data: { isActive: false } });

  await recordAuditEvent({
    action: "PRODUCT_CATEGORY_DEACTIVATED",
    entityType: "PRODUCT_CATEGORY",
    entityId: category.id,
    outcome: "SUCCESS",
    requestId: authorization.requestId,
    stallId: authorization.stall.id,
    actorProfileId: authorization.principal.user.id,
    ipHash: hashClientIp(request),
  });
  await invalidateOrganizationPublicMenus(authorization.stall.organizationId);
  return new Response(null, {
    status: 204,
    headers: { "x-request-id": authorization.requestId },
  });
}
