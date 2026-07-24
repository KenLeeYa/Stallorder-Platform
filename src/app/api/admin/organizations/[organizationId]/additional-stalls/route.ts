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
        include: { planVersion: true },
      });
      if (!subscription) throw new Error("SUBSCRIPTION_REQUIRED");
      const changeRequest = parsed.data.changeRequestId
        ? await transaction.billingChangeRequest.findFirst({
            where: {
              id: parsed.data.changeRequestId,
              organizationId,
              subscriptionId: subscription.id,
              requestType: "ADDITIONAL_STALL",
              status: "PENDING",
            },
          })
        : null;
      if (parsed.data.changeRequestId && (!changeRequest || changeRequest.requestedQuantity !== parsed.data.quantity)) {
        throw new Error("REQUEST_NOT_FOUND");
      }
      const unitPrice = subscription.planVersion.additionalStallPrice ?? parsed.data.unitPrice;
      if (unitPrice === undefined) throw new Error("UNIT_PRICE_REQUIRED");

      const existing = await transaction.additionalStallApproval.aggregate({
        where: { organizationId, status: "APPROVED", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        _sum: { quantity: true },
      });
      const existingQuantity = existing._sum.quantity ?? 0;
      if (
        subscription.planVersion.maxStalls !== null
        && subscription.planVersion.includedStalls + existingQuantity + parsed.data.quantity > subscription.planVersion.maxStalls
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
      let billingPeriodStart = subscription.billingPeriodStart;
      let billingPeriodEnd = subscription.billingPeriodEnd;
      const currentInvoice = await transaction.invoice.findUnique({
        where: { organizationId_billingPeriodStart_billingPeriodEnd: { organizationId, billingPeriodStart, billingPeriodEnd } },
      });
      if (currentInvoice && !["DRAFT", "OPEN", "OVERDUE"].includes(currentInvoice.status)) {
        const duration = billingPeriodEnd.getTime() - billingPeriodStart.getTime();
        billingPeriodStart = billingPeriodEnd;
        billingPeriodEnd = new Date(billingPeriodEnd.getTime() + duration);
      }
      const invoice = await transaction.invoice.upsert({
        where: {
          organizationId_billingPeriodStart_billingPeriodEnd: {
            organizationId,
            billingPeriodStart,
            billingPeriodEnd,
          },
        },
        update: {},
        create: {
          organizationId,
          subscriptionId: subscription.id,
          currency: authorization.workspace.defaultCurrency,
          billingPeriodStart,
          billingPeriodEnd,
          dueAt: subscription.paymentDueAt ?? billingPeriodEnd,
        },
      });
      await transaction.subscriptionItem.create({
        data: {
          organizationId,
          subscriptionId: subscription.id,
          itemType: "ADDITIONAL_STALL",
          referenceId: approval.id,
          code: "ADDITIONAL_STALL",
          description: `額外攤位 ${parsed.data.quantity} 個`,
          quantity: parsed.data.quantity,
          unitPrice,
          currency: authorization.workspace.defaultCurrency,
          startsAt: approval.effectiveAt,
          endsAt: approval.expiresAt,
        },
      });
      await transaction.invoiceLineItem.create({
        data: {
          organizationId,
          invoiceId: invoice.id,
          itemType: "ADDITIONAL_STALL",
          code: "ADDITIONAL_STALL",
          description: `額外攤位核准 ${parsed.data.quantity} 個`,
          quantity: parsed.data.quantity,
          unitPrice,
          subtotal: parsed.data.quantity * unitPrice,
          referenceId: approval.id,
        },
      });
      const updatedInvoice = await transaction.invoice.update({
        where: { id: invoice.id },
        data: { status: "OPEN", issuedAt: invoice.issuedAt ?? new Date() },
      });
      if (changeRequest) {
        await transaction.billingChangeRequest.update({
          where: { id: changeRequest.id },
          data: {
            status: "APPROVED",
            decidedByProfileId: authorization.principal.user.id,
            decisionNote: parsed.data.reason,
            decidedAt: new Date(),
            invoiceId: invoice.id,
          },
        });
      }
      const notification = await transaction.billingNotification.create({
        data: {
          organizationId,
          notificationType: "ADDITIONAL_STALL_APPROVED",
          title: "額外攤位申請已核准",
          message: `已核准 ${parsed.data.quantity} 個額外攤位，費用已加入帳單 ${invoice.invoiceNumber}。`,
          entityType: "ADDITIONAL_STALL_APPROVAL",
          entityId: approval.id,
          dedupeKey: `additional-stall-approved:${approval.id}`,
        },
      });
      await transaction.notificationOutbox.create({
        data: {
          organizationId,
          billingNotificationId: notification.id,
          channel: "IN_APP",
        },
      });
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
          afterJson: { approvedQuantity: existingQuantity + parsed.data.quantity, unitPrice, invoiceId: invoice.id, changeRequestId: changeRequest?.id ?? null },
        },
      });
      return { approval, invoiceId: invoice.id, invoiceTotal: updatedInvoice.totalAmount };
    }, { maxWait: 5_000, timeout: 20_000 });

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
      REQUEST_NOT_FOUND: "找不到相符的待審核額外攤位申請。",
    };
    return NextResponse.json(
      { error: messages[code] ?? "目前無法核准額外攤位。" },
      { status: messages[code] ? 409 : 500, headers: { "x-request-id": authorization.requestId } },
    );
  }
}
