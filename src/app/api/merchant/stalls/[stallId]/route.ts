import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { authorizeStallManagementApiRequest } from "@/lib/authorization";
import { recordAuditEvent } from "@/lib/audit";
import { validateCsrf } from "@/lib/csrf";
import { evaluateStallCreation } from "@/lib/billing";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { updateStallSchema } from "@/lib/stall-validation";

type RouteContext = { params: Promise<{ stallId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
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
  const parsed = updateStallSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "攤位資料格式不正確，請檢查後再試。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const command = parsed.data;
  try {
    const { before, stall } = await prisma.$transaction(async (transaction) => {
      const before = await transaction.stall.findFirst({
        where: { id: stallId, organizationId: authorization.workspace.id },
        select: {
          name: true,
          code: true,
          description: true,
          address: true,
          phone: true,
          timezone: true,
          currency: true,
          businessStatus: true,
          orderingEnabled: true,
          isActive: true,
        },
      });
      if (!before) throw new Error("STALL_NOT_FOUND");

      if (command.operation === "UPDATE_OPERATIONS" && !before.isActive && command.isActive) {
        await transaction.$queryRaw`
          select id
          from public.subscriptions
          where organization_id = ${authorization.workspace.id}::uuid
          for update
        `;
        const subscription = await transaction.subscription.findUnique({
          where: { organizationId: authorization.workspace.id },
          include: { plan: true },
        });
        if (!subscription) throw new Error("SUBSCRIPTION_REQUIRED");
        const now = new Date();
        const [currentActiveStalls, approvalTotal] = await Promise.all([
          transaction.stall.count({
            where: { organizationId: authorization.workspace.id, isActive: true },
          }),
          transaction.additionalStallApproval.aggregate({
            where: {
              organizationId: authorization.workspace.id,
              status: "APPROVED",
              effectiveAt: { lte: now },
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
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
      }

      const updateData = command.operation === "UPDATE_BASIC"
        ? {
            name: command.name,
            code: command.code,
            description: command.description,
            address: command.address,
            location: command.address,
            phone: command.phone,
            timezone: command.timezone,
            currency: command.currency,
          }
        : {
            businessStatus: command.businessStatus,
            orderingEnabled: command.orderingEnabled,
            isActive: command.isActive,
          };
      const stall = await transaction.stall.update({
        where: { id: stallId, organizationId: authorization.workspace.id },
        data: updateData,
        select: {
          id: true,
          name: true,
          code: true,
          description: true,
          address: true,
          phone: true,
          timezone: true,
          currency: true,
          businessStatus: true,
          orderingEnabled: true,
          isActive: true,
        },
      });
      return { before, stall };
    });
    await recordAuditEvent({
      organizationId: authorization.workspace.id,
      stallId,
      actorProfileId: authorization.principal.user.id,
      action: command.operation === "UPDATE_OPERATIONS" && !stall.isActive ? "STALL_DEACTIVATED" : "STALL_UPDATED",
      entityType: "STALL",
      entityId: stall.id,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      before,
      after: stall,
      metadata: {
        operation: command.operation,
        name: stall.name,
        code: stall.code,
        businessStatus: stall.businessStatus,
        orderingEnabled: stall.orderingEnabled,
        isActive: stall.isActive,
      },
    });
    return NextResponse.json(
      { stall },
      { headers: { "x-request-id": authorization.requestId } },
    );
  } catch (error) {
    const conflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    const code = error instanceof Error ? error.message : "";
    if (code === "STALL_NOT_FOUND") {
      return NextResponse.json(
        { error: "找不到指定資源。" },
        { status: 404, headers: { "x-request-id": authorization.requestId } },
      );
    }
    const entitlementMessages: Record<string, string> = {
      SUBSCRIPTION_REQUIRED: "此組織尚未建立訂閱，無法啟用攤位。",
      SUBSCRIPTION_INACTIVE: "訂閱目前不可啟用攤位，請先處理訂閱狀態。",
      PLAN_STALL_LIMIT: "已達方案可啟用的攤位上限。",
      ADDITIONAL_STALL_APPROVAL_REQUIRED: "啟用此攤位前需要平台核准額外攤位額度。",
    };
    const entitlementMessage = entitlementMessages[code];
    return NextResponse.json(
      { error: conflict ? "攤位代碼已被使用。" : entitlementMessage ?? "目前無法更新攤位。" },
      { status: conflict || entitlementMessage ? 409 : 500, headers: { "x-request-id": authorization.requestId } },
    );
  }
}
