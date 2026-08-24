import "server-only";

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assertSupportedBillingCycle } from "@/server/billing/billing-period";
import { assertTaxPolicy } from "@/server/billing/billing-tax-policy";
import { calculatePaygContractHash } from "@/server/billing/payg-contract";

export const createPaygContractSchema = z.object({
  sourcePlanVersionId: z.string().uuid(),
  taxTreatment: z.enum(["INCLUSIVE", "EXCLUSIVE", "EXEMPT", "OUT_OF_SCOPE"]),
  taxRateBps: z.number().int().min(0).max(10_000).nullable(),
  taxJurisdiction: z.string().trim().min(2).max(80),
  taxRoundingMode: z.enum(["HALF_UP", "HALF_EVEN", "FLOOR", "CEILING"]),
  taxRoundingScope: z.enum(["INVOICE", "STALL_LINE"]),
  capTaxBasis: z.enum(["TAX_INCLUSIVE_TOTAL", "PRE_TAX_USAGE"]).nullable(),
  taxDocumentRequired: z.boolean(),
  billingTimezone: z.string().trim().min(3).max(100),
  invoiceCloseDelayHours: z.number().int().min(0).max(744),
  reason: z.string().trim().min(5).max(500),
  confirmation: z.literal("CREATE_AND_SEAL_PAYG_VERSION"),
}).strict();

export type CreatePaygContractInput = z.infer<typeof createPaygContractSchema>;

export async function createAndSealPaygPlanVersion(
  input: CreatePaygContractInput,
  actor: { profileId: string; requestId: string; ipHash: string },
) {
  assertSupportedBillingCycle({ billingTimezone: input.billingTimezone, billingCycleAnchorDay: 1, billingPeriodType: "CALENDAR_MONTH" });
  assertTaxPolicy({
    treatment: input.taxTreatment,
    rateBps: input.taxRateBps,
    jurisdiction: input.taxJurisdiction,
    roundingMode: input.taxRoundingMode,
    roundingScope: input.taxRoundingScope,
    capTaxBasis: input.capTaxBasis,
    taxDocumentRequired: input.taxDocumentRequired,
  });

  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`select id from public.plan_versions where id = ${input.sourcePlanVersionId}::uuid for update`;
    const source = await transaction.planVersion.findUnique({
      where: { id: input.sourcePlanVersionId },
      include: { plan: true, entitlements: true },
    });
    if (!source || source.plan.code !== "PAYG" || source.pricingMode !== "USAGE_PER_STALL_CAPPED") {
      throw new Error("PAYG_SOURCE_VERSION_INVALID");
    }
    const latest = await transaction.planVersion.aggregate({
      where: { planId: source.planId },
      _max: { version: true },
    });
    const created = await transaction.planVersion.create({
      data: {
        planId: source.planId,
        version: (latest._max.version ?? 0) + 1,
        displayName: source.displayName,
        billingInterval: source.billingInterval,
        basePrice: source.basePrice,
        annualPrice: source.annualPrice,
        currency: source.currency,
        trialDays: source.trialDays,
        includedStalls: source.includedStalls,
        maxStalls: source.maxStalls,
        additionalStallPrice: source.additionalStallPrice,
        maxStaff: source.maxStaff,
        maxProducts: source.maxProducts,
        maxQrCodes: source.maxQrCodes,
        includedOrders: source.includedOrders,
        reportRetentionDays: source.reportRetentionDays,
        overagePolicy: source.overagePolicy,
        pricingMode: source.pricingMode,
        usageUnitPrice: source.usageUnitPrice,
        usageMetric: source.usageMetric,
        usageScope: source.usageScope,
        monthlyCapAmount: source.monthlyCapAmount,
        minimumCharge: source.minimumCharge,
        emergencyHardCapEnabled: source.emergencyHardCapEnabled,
        emergencyHardCapOrders: source.emergencyHardCapOrders,
        isPublic: true,
        requiresQuote: false,
        effectiveFrom: new Date(),
        createdById: actor.profileId,
        billingTimezone: input.billingTimezone,
        billingCycleAnchorDay: 1,
        billingPeriodType: "CALENDAR_MONTH",
        invoiceCloseDelayHours: input.invoiceCloseDelayHours,
        taxTreatment: input.taxTreatment,
        taxRateBps: input.taxRateBps,
        taxJurisdiction: input.taxJurisdiction,
        taxRoundingMode: input.taxRoundingMode,
        taxRoundingScope: input.taxRoundingScope,
        capTaxBasis: input.capTaxBasis,
        taxDocumentRequired: input.taxDocumentRequired,
      },
    });
    if (source.entitlements.length > 0) {
      await transaction.planEntitlement.createMany({
        data: source.entitlements.map((entitlement) => ({
          planVersionId: created.id,
          featureCode: entitlement.featureCode,
          isEnabled: entitlement.isEnabled,
          limitValue: entitlement.limitValue,
          configurationJson: entitlement.configurationJson ?? Prisma.JsonNull,
        })),
      });
    }
    const unsealed = await transaction.planVersion.findUniqueOrThrow({
      where: { id: created.id },
      include: { entitlements: true },
    });
    const contractHash = calculatePaygContractHash(unsealed);
    const sealed = await transaction.planVersion.update({
      where: { id: created.id },
      data: { sealedAt: new Date(), sealedByProfileId: actor.profileId, contractHash },
      include: { entitlements: true },
    });
    await transaction.auditLog.create({
      data: {
        actorProfileId: actor.profileId,
        action: "PAYG_PLAN_VERSION_SEALED",
        entityType: "PLAN_VERSION",
        entityId: sealed.id,
        outcome: "SUCCESS",
        requestId: actor.requestId,
        ipHash: actor.ipHash,
        metadata: input.reason,
        beforeJson: { sourcePlanVersionId: source.id, sourceVersion: source.version },
        afterJson: {
          planVersionId: sealed.id,
          version: sealed.version,
          contractHash,
          billingTimezone: sealed.billingTimezone,
          taxTreatment: sealed.taxTreatment,
          taxRateBps: sealed.taxRateBps,
          capTaxBasis: sealed.capTaxBasis,
          invoiceCloseDelayHours: sealed.invoiceCloseDelayHours,
        },
      },
    });
    return sealed;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
