import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getBillingExperienceState } from "@/server/billing/billing-feature-flags";

export const paygBillingErrorCodes = [
  "PAYG_NOT_ENABLED",
  "PAYG_OPEN_BETA_ACTIVE",
  "PAYG_REFUND_CREDITS_NOT_ENABLED",
  "PAYG_SUBSCRIPTION_NOT_FOUND",
  "PAYG_PLAN_NOT_CONFIGURED",
  "PAYG_SUBSCRIPTION_NOT_ELIGIBLE",
  "PAYG_CHANGE_REQUEST_INVALID",
  "PAYG_EFFECTIVE_DATE_INVALID",
  "PAYG_PERIOD_NOT_CLOSABLE",
  "PAYG_INVOICE_CONFLICT",
  "PAYG_INVOICE_HAS_PENDING_PAYMENT",
] as const;

export type PaygBillingErrorCode = (typeof paygBillingErrorCodes)[number];

const messages: Record<PaygBillingErrorCode, string> = {
  PAYG_NOT_ENABLED: "PAYG 計費核心尚未啟用。",
  PAYG_OPEN_BETA_ACTIVE: "目前仍是開放測試免費模式，不可建立 PAYG 收費帳單。",
  PAYG_REFUND_CREDITS_NOT_ENABLED: "完整退款折抵尚未啟用，不可關帳。",
  PAYG_SUBSCRIPTION_NOT_FOUND: "找不到指定訂閱。",
  PAYG_PLAN_NOT_CONFIGURED: "PAYG 方案價格尚未正確設定。",
  PAYG_SUBSCRIPTION_NOT_ELIGIBLE: "此訂閱目前不可遷移或關閉 PAYG 帳期。",
  PAYG_CHANGE_REQUEST_INVALID: "PAYG 申請不存在、已處理，或與此訂閱不相符。",
  PAYG_EFFECTIVE_DATE_INVALID: "PAYG 生效日必須是帳期首日，不得早於既有計費期間結束日，也不可設定為未來日期。",
  PAYG_PERIOD_NOT_CLOSABLE: "此 PAYG 帳期尚未結束或早於方案生效日。",
  PAYG_INVOICE_CONFLICT: "此帳期已有不同契約或不可修改的帳單，未進行重算。",
  PAYG_INVOICE_HAS_PENDING_PAYMENT: "此帳單仍有待核對付款，不可重算 PAYG 帳單。",
};

export class PaygBillingError extends Error {
  constructor(readonly code: PaygBillingErrorCode) {
    super(messages[code]);
    this.name = "PaygBillingError";
  }
}

type AuditContext = {
  actorProfileId: string;
  requestId: string;
  ipHash?: string;
};

const transactionOptions = { maxWait: 5_000, timeout: 20_000 } as const;

export class PaygBillingService {
  async migrateSubscription(
    subscriptionId: string,
    input: { effectiveDate: Date; reason: string; confirmation: "MIGRATE_TO_PAYG"; changeRequestId?: string },
    context: AuditContext,
  ) {
    return prisma.$transaction(async (transaction) => {
      const state = await getBillingExperienceState(transaction);
      if (!state.paygBillingEnabled) throw new PaygBillingError("PAYG_NOT_ENABLED");
      await transaction.$queryRaw`select id from public.subscriptions where id = ${subscriptionId}::uuid for update`;
      if (input.changeRequestId) {
        await transaction.$queryRaw`select id from public.billing_change_requests where id = ${input.changeRequestId}::uuid for update`;
      }
      const subscription = await transaction.subscription.findUnique({
        where: { id: subscriptionId },
        include: { plan: true, planVersion: true },
      });
      if (!subscription) throw new PaygBillingError("PAYG_SUBSCRIPTION_NOT_FOUND");
      const changeRequest = input.changeRequestId ? await transaction.billingChangeRequest.findUnique({
        where: { id: input.changeRequestId },
        include: { requestedPlanVersion: { include: { plan: true } } },
      }) : null;
      if (input.changeRequestId && (
        !changeRequest
        || changeRequest.status !== "PENDING"
        || changeRequest.requestType !== "PLAN_CHANGE"
        || changeRequest.subscriptionId !== subscription.id
        || changeRequest.organizationId !== subscription.organizationId
        || changeRequest.requestedPlanVersion?.plan.code !== "PAYG"
      )) throw new PaygBillingError("PAYG_CHANGE_REQUEST_INVALID");
      const paygVersion = changeRequest?.requestedPlanVersion ?? await findPaygPlanVersion(transaction);
      if (!paygVersion) throw new PaygBillingError("PAYG_PLAN_NOT_CONFIGURED");
      assertPaygVersion(paygVersion.plan.code, paygVersion);
      if (!["TRIAL", "LITE", "STANDARD", "PRO"].includes(subscription.plan.code)) {
        throw new PaygBillingError("PAYG_SUBSCRIPTION_NOT_ELIGIBLE");
      }
      if (
        (subscription.plan.code === "TRIAL" && !state.paygNewMerchantsEnabled)
        || (subscription.plan.code !== "TRIAL" && !state.paygLegacyMigrationEnabled)
      ) {
        throw new PaygBillingError("PAYG_NOT_ENABLED");
      }

      const effectiveDate = utcDate(input.effectiveDate);
      if (effectiveDate.getUTCDate() !== 1) throw new PaygBillingError("PAYG_EFFECTIVE_DATE_INVALID");
      if (effectiveDate < utcDate(subscription.billingPeriodEnd)) {
        throw new PaygBillingError("PAYG_EFFECTIVE_DATE_INVALID");
      }
      if (effectiveDate.getTime() > taipeiCalendarDate(new Date()).getTime()) {
        throw new PaygBillingError("PAYG_EFFECTIVE_DATE_INVALID");
      }

      const periodStart = monthStart(effectiveDate);
      const periodEnd = addUtcMonths(periodStart, 1);
      const pricingEffectiveAt = taipeiStartOfDay(effectiveDate);
      const updated = await transaction.subscription.update({
        where: { id: subscription.id },
        data: {
          planId: paygVersion.planId,
          planVersionId: paygVersion.id,
          status: "ACTIVE",
          billingInterval: "MONTHLY",
          billingPeriodStart: periodStart,
          billingPeriodEnd: periodEnd,
          pricingEffectiveAt,
          trialEndsAt: null,
          paymentDueAt: null,
          pastDueAt: null,
          gracePeriodEndsAt: null,
          suspendedAt: null,
        },
      });
      await transaction.organization.update({
        where: { id: subscription.organizationId },
        data: { status: "ACTIVE" },
      });
      if (changeRequest) {
        await transaction.billingChangeRequest.update({
          where: { id: changeRequest.id },
          data: {
            status: "APPROVED",
            decidedByProfileId: context.actorProfileId,
            decisionNote: input.reason,
            decidedAt: new Date(),
          },
        });
      }
      await transaction.auditLog.create({
        data: {
          organizationId: subscription.organizationId,
          actorProfileId: context.actorProfileId,
          action: "SUBSCRIPTION_MIGRATED_TO_PAYG",
          entityType: "SUBSCRIPTION",
          entityId: subscription.id,
          outcome: "SUCCESS",
          requestId: context.requestId,
          ipHash: context.ipHash,
          metadata: input.reason,
          beforeJson: {
            planCode: subscription.plan.code,
            planVersionId: subscription.planVersionId,
            billingPeriodStart: subscription.billingPeriodStart.toISOString(),
            billingPeriodEnd: subscription.billingPeriodEnd.toISOString(),
          },
          afterJson: {
            planCode: "PAYG",
            planVersionId: paygVersion.id,
            pricingEffectiveAt: pricingEffectiveAt.toISOString(),
            billingChangeRequestId: changeRequest?.id ?? null,
            billingPeriodStart: periodStart.toISOString(),
            billingPeriodEnd: periodEnd.toISOString(),
          },
        },
      });
      return updated;
    }, transactionOptions);
  }

  async closeBillingPeriod(
    subscriptionId: string,
    input: { billingPeriod: Date; reason: string },
    context: AuditContext,
  ) {
    return prisma.$transaction(async (transaction) => {
      const state = await getBillingExperienceState(transaction);
      if (!state.paygBillingEnabled) throw new PaygBillingError("PAYG_NOT_ENABLED");
      if (state.openBetaFreeAccess) throw new PaygBillingError("PAYG_OPEN_BETA_ACTIVE");
      if (!state.paygRefundCreditsEnabled) {
        throw new PaygBillingError("PAYG_REFUND_CREDITS_NOT_ENABLED");
      }

      await transaction.$queryRaw`select id from public.subscriptions where id = ${subscriptionId}::uuid for update`;
      const subscription = await transaction.subscription.findUnique({
        where: { id: subscriptionId },
        include: { plan: true, planVersion: true },
      });
      if (!subscription) throw new PaygBillingError("PAYG_SUBSCRIPTION_NOT_FOUND");
      assertPaygVersion(subscription.plan.code, subscription.planVersion);

      const periodStart = monthStart(input.billingPeriod);
      const periodEnd = addUtcMonths(periodStart, 1);
      if (
        periodEnd > taipeiCalendarDate(new Date())
        || !subscription.pricingEffectiveAt
        || periodStart < monthStart(taipeiCalendarDate(subscription.pricingEffectiveAt))
      ) {
        throw new PaygBillingError("PAYG_PERIOD_NOT_CLOSABLE");
      }

      await transaction.$queryRaw`
        select public.rebuild_payg_stall_usage_summaries(
          ${subscription.organizationId}::uuid,
          ${periodStart}::date,
          ${context.actorProfileId}::uuid,
          ${context.requestId}
        )
      `;
      const summaries = await transaction.billingStallUsageSummary.findMany({
        where: { organizationId: subscription.organizationId, billingPeriod: periodStart },
        include: { stall: { select: { name: true } } },
        orderBy: { stallId: "asc" },
      });

      let invoice = await transaction.invoice.findUnique({
        where: {
          organizationId_billingPeriodStart_billingPeriodEnd: {
            organizationId: subscription.organizationId,
            billingPeriodStart: periodStart,
            billingPeriodEnd: periodEnd,
          },
        },
        include: { lineItems: true },
      });
      if (invoice) {
        await transaction.$queryRaw`select id from public.invoices where id = ${invoice.id}::uuid for update`;
        invoice = await transaction.invoice.findUnique({
          where: {
            organizationId_billingPeriodStart_billingPeriodEnd: {
              organizationId: subscription.organizationId,
              billingPeriodStart: periodStart,
              billingPeriodEnd: periodEnd,
            },
          },
          include: { lineItems: true },
        });
        if (!invoice) throw new PaygBillingError("PAYG_INVOICE_CONFLICT");
      }
      if (invoice && (
        invoice.subscriptionId !== subscription.id
        || invoice.planVersionId !== subscription.planVersionId
        || invoice.pricingMode !== "USAGE_PER_STALL_CAPPED"
      )) {
        throw new PaygBillingError("PAYG_INVOICE_CONFLICT");
      }
      if (invoice && !["DRAFT", "OPEN", "OVERDUE"].includes(invoice.status)) {
        const expected = summaries.reduce((total, summary) => total + summary.finalCharge, 0);
        if (invoice.totalAmount !== expected) throw new PaygBillingError("PAYG_INVOICE_CONFLICT");
        return { invoice, summaries, idempotent: true };
      }
      if (invoice && await transaction.manualPaymentRecord.count({
        where: { invoiceId: invoice.id, verificationStatus: "PENDING_VERIFICATION" },
      }) > 0) {
        throw new PaygBillingError("PAYG_INVOICE_HAS_PENDING_PAYMENT");
      }

      const pricingSnapshot = pricingSnapshotFor(subscription.planVersion, subscription.plan.code);
      invoice ??= await transaction.invoice.create({
        data: {
          organizationId: subscription.organizationId,
          subscriptionId: subscription.id,
          planVersionId: subscription.planVersionId,
          status: "DRAFT",
          currency: subscription.planVersion.currency,
          billingPeriodStart: periodStart,
          billingPeriodEnd: periodEnd,
          pricingMode: subscription.planVersion.pricingMode,
          pricingSnapshotJson: pricingSnapshot,
          dueAt: addUtcDays(periodEnd, 7),
        },
        include: { lineItems: true },
      });

      await transaction.invoiceLineItem.deleteMany({
        where: { invoiceId: invoice.id, itemType: "PAYG_USAGE" },
      });
      if (summaries.length > 0) {
        await transaction.invoiceLineItem.createMany({
          data: summaries.map((summary) => ({
            organizationId: subscription.organizationId,
            invoiceId: invoice!.id,
            itemType: "PAYG_USAGE",
            code: "PAYG_STALL_USAGE",
            description: `${summary.stall.name}｜PAYG 完成訂單用量`,
            quantity: 1,
            unitPrice: summary.finalCharge,
            subtotal: summary.finalCharge,
            referenceId: summary.stallId,
            metadataJson: {
              stallId: summary.stallId,
              stallName: summary.stall.name,
              billingPeriod: periodStart.toISOString().slice(0, 10),
              grossCompletedOrders: summary.grossCompletedOrderCount,
              fullRefundCredits: summary.fullRefundCreditCount,
              netBillableOrders: summary.netBillableOrderCount,
              usageUnitPrice: summary.unitPrice,
              uncappedAmount: summary.uncappedAmount,
              monthlyCapAmount: summary.capAmount,
              finalCharge: summary.finalCharge,
              capSavings: summary.capSavings,
            },
          })),
        });
      }
      const opened = await transaction.invoice.update({
        where: { id: invoice.id },
        data: {
          status: "OPEN",
          issuedAt: invoice.issuedAt ?? new Date(),
          planVersionId: subscription.planVersionId,
          pricingMode: subscription.planVersion.pricingMode,
          pricingSnapshotJson: pricingSnapshot,
        },
        include: { lineItems: true },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: subscription.organizationId,
          actorProfileId: context.actorProfileId,
          action: "PAYG_INVOICE_CLOSED",
          entityType: "INVOICE",
          entityId: opened.id,
          outcome: "SUCCESS",
          requestId: context.requestId,
          ipHash: context.ipHash,
          metadata: input.reason,
          afterJson: {
            billingPeriod: periodStart.toISOString(),
            stallCount: summaries.length,
            totalAmount: summaries.reduce((total, summary) => total + summary.finalCharge, 0),
            planVersionId: subscription.planVersionId,
          },
        },
      });
      return { invoice: opened, summaries, idempotent: false };
    }, transactionOptions);
  }
}

async function findPaygPlanVersion(transaction: Prisma.TransactionClient) {
  return transaction.planVersion.findFirst({
    where: {
      pricingMode: "USAGE_PER_STALL_CAPPED",
      isPublic: true,
      requiresQuote: false,
      effectiveFrom: { lte: new Date() },
      OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: new Date() } }],
      plan: { code: "PAYG", isActive: true },
    },
    include: { plan: true },
    orderBy: { version: "desc" },
  });
}

function assertPaygVersion(planCode: string, version: {
  pricingMode: string;
  currency: string;
  basePrice: number;
  usageUnitPrice: number;
  usageMetric: string | null;
  usageScope: string | null;
  monthlyCapAmount: number | null;
  minimumCharge: number;
}) {
  if (
    planCode !== "PAYG"
    || version.pricingMode !== "USAGE_PER_STALL_CAPPED"
    || version.currency !== "TWD"
    || version.basePrice !== 0
    || version.usageUnitPrice !== 1
    || version.usageMetric !== "NET_BILLABLE_COMPLETED_ORDER"
    || version.usageScope !== "STALL"
    || version.monthlyCapAmount !== 1499
    || version.minimumCharge !== 0
  ) throw new PaygBillingError("PAYG_PLAN_NOT_CONFIGURED");
}

function pricingSnapshotFor(version: {
  id: string;
  version: number;
  currency: string;
  basePrice: number;
  pricingMode: string;
  usageUnitPrice: number;
  usageMetric: string | null;
  usageScope: string | null;
  monthlyCapAmount: number | null;
  minimumCharge: number;
}, planCode: string) {
  return {
    planVersionId: version.id,
    planCode,
    planVersion: version.version,
    pricingMode: version.pricingMode,
    currency: version.currency,
    baseFee: version.basePrice,
    usageUnitPrice: version.usageUnitPrice,
    usageMetric: version.usageMetric,
    usageScope: version.usageScope,
    monthlyCapAmount: version.monthlyCapAmount,
    minimumCharge: version.minimumCharge,
  } satisfies Prisma.InputJsonObject;
}

function utcDate(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function taipeiCalendarDate(value: Date) {
  const shifted = new Date(value.getTime() + 8 * 60 * 60 * 1_000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

function taipeiStartOfDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()) - 8 * 60 * 60 * 1_000);
}

function monthStart(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function addUtcMonths(value: Date, count: number) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + count, 1));
}

function addUtcDays(value: Date, count: number) {
  return new Date(value.getTime() + count * 86_400_000);
}

export const paygBillingService = new PaygBillingService();
