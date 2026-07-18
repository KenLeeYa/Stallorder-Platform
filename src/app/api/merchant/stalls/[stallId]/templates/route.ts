import { NextResponse } from "next/server";
import type { UserRole } from "@prisma/client";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeStallManagementApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/rbac";
import { hashClientIp } from "@/lib/security";
import { applyStallTemplateSchema, getStallTemplatePreview, loadStallTemplateData } from "@/lib/stall-template";
import { invalidatePublicMenu } from "@/lib/public-menu";

type RouteContext = { params: Promise<{ stallId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { stallId } = await context.params;
  const authorization = await authorizeStallManagementApiRequest(request, stallId, "MANAGE_STALL");
  if (!authorization.ok) return authorization.response;
  const sourceStallId = new URL(request.url).searchParams.get("sourceStallId");
  if (!sourceStallId || !canUseSourceStall(authorization, sourceStallId)) {
    return NextResponse.json(
      { error: "找不到可使用的來源攤位。" },
      { status: 404, headers: { "x-request-id": authorization.requestId } },
    );
  }
  return NextResponse.json(
    { preview: await getStallTemplatePreview(sourceStallId, stallId, authorization.workspace.id) },
    { headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } },
  );
}

export async function POST(request: Request, context: RouteContext) {
  const { stallId } = await context.params;
  const authorization = await authorizeStallManagementApiRequest(request, stallId, "MANAGE_STALL");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }
  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = applyStallTemplateSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "攤位範本格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }
  if (parsed.data.sourceStallId === stallId || !canUseSourceStall(authorization, parsed.data.sourceStallId)) {
    return NextResponse.json(
      { error: "來源攤位不可與目前攤位相同，且必須具備管理權限。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const organizationId = authorization.workspace.id;
  const source = await loadStallTemplateData(parsed.data.sourceStallId, organizationId);
  await prisma.$transaction(async (transaction) => {
    if (parsed.data.sections.includes("PAYMENTS")) {
      await transaction.paymentOption.deleteMany({ where: { organizationId, stallId } });
      if (source.paymentOptions.length > 0) {
        await transaction.paymentOption.createMany({
          data: source.paymentOptions.map((option) => ({
            organizationId,
            stallId,
            code: option.code,
            name: option.name,
            kind: option.kind,
            isEnabled: option.isEnabled,
            sortOrder: option.sortOrder,
          })),
        });
      }
      await transaction.stallOrderingSettings.update({
        where: { stallId },
        data: { paymentModuleEnabled: source.settings.paymentModuleEnabled },
      });
    }
    if (parsed.data.sections.includes("DISCOUNTS")) {
      await transaction.discountOption.deleteMany({ where: { organizationId, stallId } });
      if (source.discounts.length > 0) {
        await transaction.discountOption.createMany({
          data: source.discounts.map((option) => ({
            organizationId,
            stallId,
            name: option.name,
            rateBps: option.rateBps,
            isEnabled: option.isEnabled,
            sortOrder: option.sortOrder,
          })),
        });
      }
      await transaction.stallOrderingSettings.update({
        where: { stallId },
        data: {
          discountModuleEnabled: source.settings.discountModuleEnabled,
          discountApprovalThresholdBps: source.settings.discountApprovalThresholdBps,
        },
      });
    }
    if (parsed.data.sections.includes("PRODUCT_AVAILABILITY")) {
      const sourceProductIds = source.stallProducts.map((item) => item.productId);
      await transaction.stallProduct.updateMany({
        where: { organizationId, stallId, productId: { notIn: sourceProductIds } },
        data: { isEnabled: false, isSoldOut: false, availableFrom: null, availableUntil: null },
      });
      for (const item of source.stallProducts) {
        await transaction.stallProduct.upsert({
          where: { stallId_productId: { stallId, productId: item.productId } },
          create: {
            organizationId,
            stallId,
            productId: item.productId,
            priceOverride: item.priceOverride,
            isEnabled: item.isEnabled,
            isSoldOut: item.isSoldOut,
            availableFrom: item.availableFrom,
            availableUntil: item.availableUntil,
            sortOrder: item.sortOrder,
          },
          update: {
            priceOverride: item.priceOverride,
            isEnabled: item.isEnabled,
            isSoldOut: item.isSoldOut,
            availableFrom: item.availableFrom,
            availableUntil: item.availableUntil,
            sortOrder: item.sortOrder,
          },
        });
      }
    }
    if (parsed.data.sections.includes("BUSINESS_HOURS")) {
      await transaction.stallBusinessHour.deleteMany({ where: { organizationId, stallId } });
      if (source.businessHours.length > 0) {
        await transaction.stallBusinessHour.createMany({
          data: source.businessHours.map((hour) => ({
            organizationId,
            stallId,
            dayOfWeek: hour.dayOfWeek,
            opensAt: hour.opensAt,
            closesAt: hour.closesAt,
            isClosed: hour.isClosed,
          })),
        });
      }
    }
  });

  await recordAuditEvent({
    organizationId,
    stallId,
    actorProfileId: authorization.principal.user.id,
    action: "STALL_TEMPLATE_APPLIED",
    entityType: "STALL",
    entityId: stallId,
    outcome: "SUCCESS",
    requestId: authorization.requestId,
    ipHash: hashClientIp(request),
    metadata: { sourceStallId: parsed.data.sourceStallId, sections: parsed.data.sections.join(",") },
  });
  invalidatePublicMenu(stallId);
  return NextResponse.json(
    { preview: await getStallTemplatePreview(parsed.data.sourceStallId, stallId, organizationId) },
    { headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } },
  );
}

function canUseSourceStall(
  authorization: { workspace: { roles: readonly UserRole[]; stalls: readonly { id: string; roles: readonly UserRole[] }[] } },
  sourceStallId: string,
) {
  const source = authorization.workspace.stalls.find((stall) => stall.id === sourceStallId);
  if (!source) return false;
  const roles = [...authorization.workspace.roles, ...source.roles];
  return roles.some((role) => hasPermission(role, "MANAGE_STALL"));
}
