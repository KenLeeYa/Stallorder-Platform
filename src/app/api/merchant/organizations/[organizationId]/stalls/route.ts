import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { recordAuditEvent } from "@/lib/audit";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { evaluateStallCreation } from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import { createStallSchema } from "@/lib/stall-validation";

type RouteContext = { params: Promise<{ organizationId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(
    request,
    organizationId,
    "MANAGE_ORGANIZATION",
  );
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = createStallSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "攤位資料格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  try {
    const stall = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`select id from public.subscriptions where organization_id = ${organizationId}::uuid for update`;
      const subscription = await transaction.subscription.findUnique({
        where: { organizationId },
        include: { plan: true },
      });
      if (!subscription) throw new Error("SUBSCRIPTION_REQUIRED");
      const [currentActiveStalls, approvalTotal] = await Promise.all([
        transaction.stall.count({ where: { organizationId, isActive: true } }),
        transaction.additionalStallApproval.aggregate({
          where: {
            organizationId,
            status: "APPROVED",
            effectiveAt: { lte: new Date() },
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          _sum: { quantity: true },
        }),
      ]);
      const entitlement = evaluateStallCreation({
        subscriptionStatus: subscription.status,
        currentActiveStalls,
        includedStalls: subscription.plan.includedStalls,
        maxStalls: subscription.plan.maxStalls,
        approvedAdditionalStalls: approvalTotal._sum.quantity ?? 0,
      });
      if (!entitlement.allowed) throw new Error(entitlement.code);

      return transaction.stall.create({
        data: {
          organizationId,
          ...parsed.data,
          location: parsed.data.address,
          orderingSettings: { create: { organizationId } },
          qrCodes: {
            create: {
              organizationId,
              token: randomBytes(32).toString("base64url"),
              label: "主要點餐 QR v1",
            },
          },
        },
        select: { id: true, name: true, slug: true, code: true },
      });
    });

    await recordAuditEvent({
      organizationId,
      stallId: stall.id,
      actorProfileId: authorization.principal.user.id,
      action: "STALL_CREATED",
      entityType: "STALL",
      entityId: stall.id,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      after: { name: stall.name, slug: stall.slug, code: stall.code },
      metadata: { name: stall.name, code: stall.code },
    });
    return NextResponse.json(
      { stall },
      { status: 201, headers: { "x-request-id": authorization.requestId } },
    );
  } catch (error) {
    const conflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    const entitlementCode = error instanceof Error ? error.message : "";
    const entitlementMessages: Record<string, string> = {
      SUBSCRIPTION_REQUIRED: "此組織尚未建立訂閱，無法新增攤位。",
      SUBSCRIPTION_INACTIVE: "訂閱目前不可新增攤位，請先處理訂閱狀態。",
      PLAN_STALL_LIMIT: "已達方案可建立的攤位上限。",
      ADDITIONAL_STALL_APPROVAL_REQUIRED: "此攤位需要平台管理員先核准額外攤位額度。",
    };
    const entitlementMessage = entitlementMessages[entitlementCode];
    return NextResponse.json(
      { error: conflict ? "攤位代碼或網址代稱已被使用。" : entitlementMessage ?? "目前無法建立攤位。" },
      { status: conflict || entitlementMessage ? 409 : 500, headers: { "x-request-id": authorization.requestId } },
    );
  }
}
