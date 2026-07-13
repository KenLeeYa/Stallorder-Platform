import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { hashClientIp } from "@/lib/security";
import { additionalStallApprovalSchema } from "@/lib/subscription-validation";

type RouteContext = { params: Promise<{ organizationId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(request, organizationId, "PLATFORM_ADMIN");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = additionalStallApprovalSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "核准數量、單價或原因格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  try {
    const result = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`select id from public.subscriptions where organization_id = ${organizationId}::uuid for update`;
      const subscription = await transaction.subscription.findUnique({
        where: { organizationId },
        include: { plan: true },
      });
      if (!subscription) throw new Error("SUBSCRIPTION_REQUIRED");
      const unitPrice = subscription.plan.additionalStallPrice ?? parsed.data.unitPrice;
      if (unitPrice === undefined) throw new Error("UNIT_PRICE_REQUIRED");

      const existing = await transaction.additionalStallApproval.aggregate({
        where: { organizationId, status: "APPROVED", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        _sum: { quantity: true },
      });
      const existingQuantity = existing._sum.quantity ?? 0;
      if (
        subscription.plan.maxStalls !== null
        && subscription.plan.includedStalls + existingQuantity + parsed.data.quantity > subscription.plan.maxStalls
      ) throw new Error("PLAN_STALL_LIMIT");

      const approval = await transaction.additionalStallApproval.create({
        data: {
          organizationId,
          subscriptionId: subscription.id,
          quantity: parsed.data.quantity,
          unitPrice,
          approvedById: authorization.principal.user.id,
          reason: parsed.data.reason,
        },
      });
      const invoice = await transaction.invoice.upsert({
        where: {
          organizationId_billingPeriodStart_billingPeriodEnd: {
            organizationId,
            billingPeriodStart: subscription.billingPeriodStart,
            billingPeriodEnd: subscription.billingPeriodEnd,
          },
        },
        update: {},
        create: {
          organizationId,
          subscriptionId: subscription.id,
          invoiceNumber: `SO-${subscription.billingPeriodStart.toISOString().slice(0, 7).replace("-", "")}-${randomBytes(4).toString("hex").toUpperCase()}`,
          currency: authorization.workspace.defaultCurrency,
          billingPeriodStart: subscription.billingPeriodStart,
          billingPeriodEnd: subscription.billingPeriodEnd,
        },
      });
      await transaction.invoiceLineItem.create({
        data: {
          organizationId,
          invoiceId: invoice.id,
          lineType: "ADDITIONAL_STALL",
          description: `額外攤位核准 ${parsed.data.quantity} 個`,
          quantity: parsed.data.quantity,
          unitAmount: unitPrice,
          amount: parsed.data.quantity * unitPrice,
          referenceId: approval.id,
        },
      });
      const totals = await transaction.invoiceLineItem.aggregate({
        where: { invoiceId: invoice.id },
        _sum: { amount: true },
      });
      const total = totals._sum.amount ?? 0;
      await transaction.invoice.update({ where: { id: invoice.id }, data: { subtotal: total, total } });
      await transaction.auditLog.create({
        data: {
          organizationId,
          actorProfileId: authorization.principal.user.id,
          action: "ADDITIONAL_STALL_APPROVED",
          entityType: "ADDITIONAL_STALL_APPROVAL",
          entityId: approval.id,
          outcome: "SUCCESS",
          requestId: authorization.requestId,
          ipHash: hashClientIp(request),
          beforeJson: { approvedQuantity: existingQuantity },
          afterJson: { approvedQuantity: existingQuantity + parsed.data.quantity, unitPrice, invoiceId: invoice.id },
        },
      });
      return { approval, invoiceId: invoice.id, invoiceTotal: total };
    });

    return NextResponse.json(result, {
      status: 201,
      headers: { "cache-control": "no-store", "x-request-id": authorization.requestId },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const messages: Record<string, string> = {
      SUBSCRIPTION_REQUIRED: "此組織尚未建立訂閱。",
      UNIT_PRICE_REQUIRED: "Enterprise 方案必須指定額外攤位單價。",
      PLAN_STALL_LIMIT: "核准後會超過方案攤位上限。",
    };
    return NextResponse.json(
      { error: messages[code] ?? "目前無法核准額外攤位。" },
      { status: messages[code] ? 409 : 500, headers: { "x-request-id": authorization.requestId } },
    );
  }
}
