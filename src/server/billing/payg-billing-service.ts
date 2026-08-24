import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { billingPeriodForInstant, billingPeriodStartInstant, hasBillingPeriodEnded } from "@/server/billing/billing-period";
import { calculateBillingTax, type BillingCapTaxBasis, type BillingTaxRoundingMode, type BillingTaxRoundingScope, type BillingTaxTreatment } from "@/server/billing/billing-tax-policy";
import { getBillingExperienceState } from "@/server/billing/billing-feature-flags";
import { assertPaygContractIntegrity, type PaygContractVersion } from "@/server/billing/payg-contract";

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
  "PAYG_PLAN_VERSION_NOT_SEALED",
  "PAYG_CONTRACT_HASH_MISMATCH",
  "PAYG_BILLING_TIMEZONE_INVALID",
  "PAYG_BILLING_CYCLE_UNSUPPORTED",
  "PAYG_SUBSCRIPTION_CONTRACT_MISMATCH",
  "PAYG_TAX_POLICY_UNCONFIGURED",
  "PAYG_TAX_POLICY_MISMATCH",
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
  PAYG_PLAN_VERSION_NOT_SEALED: "PAYG 方案版本尚未封存，不可用於正式計費。",
  PAYG_CONTRACT_HASH_MISMATCH: "PAYG 方案契約雜湊不一致，已停止計費。",
  PAYG_BILLING_TIMEZONE_INVALID: "PAYG 計費時區無效，已停止計費。",
  PAYG_BILLING_CYCLE_UNSUPPORTED: "PAYG 計費週期不受支援，已停止計費。",
  PAYG_SUBSCRIPTION_CONTRACT_MISMATCH: "訂閱的計費契約快照與方案版本不一致。",
  PAYG_TAX_POLICY_UNCONFIGURED: "PAYG 稅務契約尚未核准設定，不可關帳。",
  PAYG_TAX_POLICY_MISMATCH: "PAYG 稅務契約不一致，已停止計費。",
};

export class PaygBillingError extends Error {
  constructor(readonly code: PaygBillingErrorCode) {
    super(messages[code]);
    this.name = "PaygBillingError";
  }
}

type AuditContext = {
  actorProfileId: string | null;
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
        include: { plan: true, planVersion: { include: { entitlements: true } } },
      });
      if (!subscription) throw new PaygBillingError("PAYG_SUBSCRIPTION_NOT_FOUND");
      const changeRequest = input.changeRequestId ? await transaction.billingChangeRequest.findUnique({
        where: { id: input.changeRequestId },
        include: { requestedPlanVersion: { include: { plan: true, entitlements: true } } },
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
      assertChargeablePaygContract(paygVersion);
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
      if (effectiveDate.getTime() > billingPeriodForInstant(new Date(), paygVersion).getTime()) {
        throw new PaygBillingError("PAYG_EFFECTIVE_DATE_INVALID");
      }

      const periodStart = monthStart(effectiveDate);
      const periodEnd = addUtcMonths(periodStart, 1);
      const pricingEffectiveAt = billingPeriodStartInstant(effectiveDate, paygVersion);
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
          billingTimezone: paygVersion.billingTimezone,
          billingCycleAnchorDay: paygVersion.billingCycleAnchorDay,
          billingPeriodType: paygVersion.billingPeriodType,
          invoiceCloseDelayHours: paygVersion.invoiceCloseDelayHours,
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
            billingTimezone: paygVersion.billingTimezone,
            contractHash: paygVersion.contractHash,
            taxTreatment: paygVersion.taxTreatment,
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
        include: { plan: true, planVersion: { include: { entitlements: true } } },
      });
      if (!subscription) throw new PaygBillingError("PAYG_SUBSCRIPTION_NOT_FOUND");
      assertPaygVersion(subscription.plan.code, subscription.planVersion);
      assertChargeablePaygContract(subscription.planVersion);
      if (
        subscription.billingTimezone !== subscription.planVersion.billingTimezone
        || subscription.billingCycleAnchorDay !== subscription.planVersion.billingCycleAnchorDay
        || subscription.billingPeriodType !== subscription.planVersion.billingPeriodType
        || subscription.invoiceCloseDelayHours !== subscription.planVersion.invoiceCloseDelayHours
      ) throw new PaygBillingError("PAYG_SUBSCRIPTION_CONTRACT_MISMATCH");

      const periodStart = monthStart(input.billingPeriod);
      const periodEnd = addUtcMonths(periodStart, 1);
      if (
        !hasBillingPeriodEnded(periodStart, subscription)
        || !subscription.pricingEffectiveAt
        || periodStart < billingPeriodForInstant(subscription.pricingEffectiveAt, subscription)
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
        include: { lineItems: true, taxDocuments: { select: { status: true } } },
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
          include: { lineItems: true, taxDocuments: { select: { status: true } } },
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
      if (invoice && (
        !["DRAFT", "OPEN", "OVERDUE"].includes(invoice.status)
        || invoice.taxDocuments.some((document) => document.status === "ISSUED")
      )) {
        if (invoiceContractHash(invoice.pricingSnapshotJson) !== subscription.planVersion.contractHash) {
          throw new PaygBillingError("PAYG_INVOICE_CONFLICT");
        }
        return { invoice, summaries, idempotent: true };
      }
      if (invoice && await transaction.manualPaymentRecord.count({
        where: { invoiceId: invoice.id, verificationStatus: "PENDING_VERIFICATION" },
      }) > 0) {
        throw new PaygBillingError("PAYG_INVOICE_HAS_PENDING_PAYMENT");
      }

      const usageAmounts = summaries.map((summary) => summary.finalCharge);
      const taxPolicy = taxPolicyFor(subscription.planVersion);
      const tax = calculateBillingTax({
        ...taxPolicy,
        taxableAmount: usageAmounts.reduce((total, amount) => total + amount, 0),
        lineAmounts: taxPolicy.roundingScope === "STALL_LINE" && usageAmounts.length > 0 ? usageAmounts : undefined,
      });
      const inclusiveLineTaxes = subscription.planVersion.taxTreatment === "INCLUSIVE"
        ? calculateInclusiveLineTaxes(usageAmounts, tax.taxAmount, taxPolicy)
        : usageAmounts.map(() => 0);
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
          dueAt: addUtcDays(billingPeriodStartInstant(periodEnd, subscription), 7),
        },
        include: { lineItems: true, taxDocuments: { select: { status: true } } },
      });

      await transaction.$queryRaw`
        select id from public.billing_credit_adjustments
        where subscription_id = ${subscription.id}::uuid
          and (status = 'UNAPPLIED' or target_invoice_id = ${invoice.id}::uuid)
        order by created_at, id
        for update
      `;
      const creditCandidates = await transaction.billingCreditAdjustment.findMany({
        where: {
          subscriptionId: subscription.id,
          OR: [
            { status: "UNAPPLIED" },
            { status: "APPLIED", targetInvoiceId: invoice.id },
          ],
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      const originalInvoices = creditCandidates.length > 0
        ? await transaction.invoice.findMany({
          where: { id: { in: creditCandidates.map((credit) => credit.originalInvoiceId) } },
          select: { id: true, billingPeriodEnd: true },
        })
        : [];
      const originalPeriodEnd = new Map(originalInvoices.map((candidate) => [candidate.id, candidate.billingPeriodEnd]));
      const applicableCredits = creditCandidates.filter((credit) => {
        const end = originalPeriodEnd.get(credit.originalInvoiceId);
        return end && end <= periodStart;
      });
      const selectedCredits = selectCreditsWithinTotal(applicableCredits, tax.totalAmount);
      const selectedCreditIds = new Set(selectedCredits.map((credit) => credit.id));
      const creditTotal = selectedCredits.reduce((total, credit) => total + credit.creditAmount + credit.taxCreditAmount, 0);

      await transaction.invoiceLineItem.deleteMany({
        where: {
          invoiceId: invoice.id,
          OR: [
            { itemType: "PAYG_USAGE" },
            { itemType: "CREDIT", code: "PAYG_LATE_REFUND_CREDIT" },
          ],
        },
      });
      if (summaries.length > 0) {
        await transaction.invoiceLineItem.createMany({
          data: summaries.map((summary, index) => ({
            organizationId: subscription.organizationId,
            invoiceId: invoice!.id,
            itemType: "PAYG_USAGE",
            code: "PAYG_STALL_USAGE",
            description: `${summary.stall.name}｜PAYG 完成訂單用量`,
            quantity: 1,
            unitPrice: summary.finalCharge - inclusiveLineTaxes[index]!,
            subtotal: summary.finalCharge - inclusiveLineTaxes[index]!,
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
              extractedTax: inclusiveLineTaxes[index],
              capSavings: summary.capSavings,
            },
          })),
        });
      }
      if (selectedCredits.length > 0) {
        await transaction.invoiceLineItem.createMany({
          data: selectedCredits.map((credit) => ({
            organizationId: subscription.organizationId,
            invoiceId: invoice!.id,
            itemType: "CREDIT",
            code: "PAYG_LATE_REFUND_CREDIT",
            description: "先前帳期完整退款折抵",
            quantity: 1,
            unitPrice: credit.creditAmount + credit.taxCreditAmount,
            subtotal: credit.creditAmount + credit.taxCreditAmount,
            referenceId: credit.id,
            metadataJson: {
              adjustmentId: credit.id,
              originalInvoiceId: credit.originalInvoiceId,
              originalOrderId: credit.originalOrderId,
              creditAmount: credit.creditAmount,
              taxCreditAmount: credit.taxCreditAmount,
              reasonCode: credit.reasonCode,
            },
          })),
        });
      }
      const previouslyApplied = creditCandidates.filter((credit) => credit.targetInvoiceId === invoice!.id && !selectedCreditIds.has(credit.id));
      if (previouslyApplied.length > 0) {
        await transaction.billingCreditAdjustment.updateMany({
          where: { id: { in: previouslyApplied.map((credit) => credit.id) }, targetInvoiceId: invoice.id },
          data: { status: "UNAPPLIED", targetInvoiceId: null, appliedAt: null },
        });
      }
      if (selectedCredits.length > 0) {
        await transaction.billingCreditAdjustment.updateMany({
          where: { id: { in: selectedCredits.map((credit) => credit.id) } },
          data: { status: "APPLIED", targetInvoiceId: invoice.id, appliedAt: new Date() },
        });
      }
      const totalAmount = tax.totalAmount - creditTotal;
      if (invoice.amountPaid > totalAmount) throw new PaygBillingError("PAYG_INVOICE_CONFLICT");
      const opened = await transaction.invoice.update({
        where: { id: invoice.id },
        data: {
          status: "OPEN",
          issuedAt: invoice.issuedAt ?? new Date(),
          planVersionId: subscription.planVersionId,
          pricingMode: subscription.planVersion.pricingMode,
          pricingSnapshotJson: pricingSnapshot,
          subtotal: tax.subtotal,
          taxAmount: tax.taxAmount,
          discountAmount: creditTotal,
          totalAmount,
          amountDue: totalAmount - invoice.amountPaid,
        },
        include: { lineItems: true },
      });
      if (monthStart(subscription.billingPeriodStart).getTime() === periodStart.getTime()) {
        await transaction.subscription.update({
          where: { id: subscription.id },
          data: {
            billingPeriodStart: periodEnd,
            billingPeriodEnd: addUtcMonths(periodEnd, 1),
          },
        });
      }
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
            subtotal: tax.subtotal,
            taxAmount: tax.taxAmount,
            creditAmount: creditTotal,
            totalAmount,
            planVersionId: subscription.planVersionId,
            contractHash: subscription.planVersion.contractHash,
            billingTimezone: subscription.billingTimezone,
            closeMode: context.actorProfileId ? "MANUAL_ADMIN_CLOSE" : "AUTOMATIC_SYSTEM_CLOSE",
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
      sealedAt: { not: null },
      contractHash: { not: null },
      taxTreatment: { not: "UNCONFIGURED" },
      OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: new Date() } }],
      plan: { code: "PAYG", isActive: true },
    },
    include: { plan: true, entitlements: true },
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

function assertChargeablePaygContract(version: PaygContractVersion) {
  try {
    assertPaygContractIntegrity(version);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if ((paygBillingErrorCodes as readonly string[]).includes(code)) {
      throw new PaygBillingError(code as PaygBillingErrorCode);
    }
    throw new PaygBillingError("PAYG_TAX_POLICY_MISMATCH");
  }
}

function taxPolicyFor(version: PaygContractVersion) {
  return {
    treatment: version.taxTreatment as BillingTaxTreatment,
    rateBps: version.taxRateBps,
    jurisdiction: version.taxJurisdiction,
    roundingMode: version.taxRoundingMode as BillingTaxRoundingMode,
    roundingScope: version.taxRoundingScope as BillingTaxRoundingScope,
    capTaxBasis: version.capTaxBasis as BillingCapTaxBasis,
    taxDocumentRequired: version.taxDocumentRequired,
  };
}

function pricingSnapshotFor(version: PaygContractVersion, planCode: string) {
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
    billingTimezone: version.billingTimezone,
    billingCycleAnchorDay: version.billingCycleAnchorDay,
    billingPeriodType: version.billingPeriodType,
    invoiceCloseDelayHours: version.invoiceCloseDelayHours,
    taxTreatment: version.taxTreatment,
    taxRateBps: version.taxRateBps,
    taxJurisdiction: version.taxJurisdiction,
    taxRoundingMode: version.taxRoundingMode,
    taxRoundingScope: version.taxRoundingScope,
    capTaxBasis: version.capTaxBasis,
    taxDocumentRequired: version.taxDocumentRequired,
    contractHash: version.contractHash,
  } satisfies Prisma.InputJsonObject;
}

function invoiceContractHash(snapshot: Prisma.JsonValue | null) {
  if (!snapshot || Array.isArray(snapshot) || typeof snapshot !== "object") return null;
  const value = snapshot.contractHash;
  return typeof value === "string" ? value : null;
}

function calculateInclusiveLineTaxes(
  amounts: readonly number[],
  totalTax: number,
  policy: ReturnType<typeof taxPolicyFor>,
) {
  if (policy.roundingScope === "STALL_LINE") {
    return amounts.map((amount) => calculateBillingTax({
      ...policy,
      roundingScope: "INVOICE",
      taxableAmount: amount,
    }).taxAmount);
  }
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  if (total === 0) return amounts.map(() => 0);
  const allocated = amounts.map((amount) => Math.floor(totalTax * amount / total));
  let remainder = totalTax - allocated.reduce((sum, amount) => sum + amount, 0);
  for (let index = 0; remainder > 0 && index < allocated.length; index += 1, remainder -= 1) {
    allocated[index] = allocated[index]! + 1;
  }
  return allocated;
}

function selectCreditsWithinTotal<T extends { creditAmount: number; taxCreditAmount: number }>(
  credits: readonly T[],
  totalAmount: number,
) {
  const selected: T[] = [];
  let applied = 0;
  for (const credit of credits) {
    const amount = credit.creditAmount + credit.taxCreditAmount;
    if (applied + amount > totalAmount) continue;
    selected.push(credit);
    applied += amount;
  }
  return selected;
}

function utcDate(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
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
