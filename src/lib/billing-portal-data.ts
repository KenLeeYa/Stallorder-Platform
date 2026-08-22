import "server-only";

import { prisma } from "@/lib/prisma";
import {
  entitlementService,
  resolvePlanEntitlements,
} from "@/server/billing/entitlement-service";
import { getBillingExperienceState } from "@/server/billing/billing-feature-flags";

const taipeiBillingDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
});

export async function getMerchantBillingPortalData(organizationId: string) {
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId },
    include: {
      plan: true,
      planVersion: { include: { plan: true, entitlements: { orderBy: { featureCode: "asc" } } } },
      items: { where: { status: "ACTIVE" }, orderBy: { createdAt: "desc" } },
      invoices: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
          lineItems: { orderBy: { createdAt: "asc" } },
          manualPayments: { orderBy: { createdAt: "desc" } },
        },
      },
      billingChangeRequests: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { requestedPlanVersion: { include: { plan: true } } },
      },
    },
  });
  if (!subscription) return null;
  const isPayg = subscription.planVersion.pricingMode === "USAGE_PER_STALL_CAPPED";
  const [usage, warnings, effectiveEntitlements, notifications, availablePlans, orderPackages, paygStallUsage, billingExperience] = await Promise.all([
    entitlementService.getBillingPeriodUsage(organizationId, subscription.billingPeriodStart),
    entitlementService.getUsageWarnings(organizationId),
    entitlementService.getEffectiveEntitlements(organizationId),
    prisma.billingNotification.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.planVersion.findMany({
      where: {
        isPublic: true,
        requiresQuote: false,
        effectiveFrom: { lte: new Date() },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: new Date() } }],
        plan: { isActive: true, code: { not: "TRIAL" } },
      },
      include: { plan: true, entitlements: { orderBy: { featureCode: "asc" } } },
      orderBy: [{ basePrice: "asc" }, { version: "desc" }],
    }),
    isPayg
      ? Promise.resolve([])
      : prisma.addOnCatalog.findMany({
        where: {
          isActive: true,
          availabilityStatus: "ENABLED",
          code: { startsWith: `ORDER_PACKAGE_${subscription.plan.code}_` },
        },
        orderBy: { unitPrice: "asc" },
      }),
    isPayg
      ? prisma.billingStallUsageSummary.findMany({
        where: {
          organizationId,
          billingPeriod: billingPeriodMonthStartInTaipei(subscription.billingPeriodStart),
        },
        include: { stall: { select: { name: true } } },
        orderBy: { stallId: "asc" },
      })
      : Promise.resolve([]),
    getBillingExperienceState(),
  ]);
  const paygRequestsEnabled = billingExperience.paygBillingEnabled && (
    subscription.plan.code === "TRIAL"
      ? billingExperience.paygNewMerchantsEnabled
      : ["LITE", "STANDARD", "PRO"].includes(subscription.plan.code)
        && billingExperience.paygLegacyMigrationEnabled
  );
  return {
    subscription,
    usage,
    warnings,
    effectiveEntitlements,
    notifications,
    availablePlans: availablePlans
      .filter((version) => (
        subscription.plan.code !== "PAYG"
        && version.pricingMode === "FIXED"
        && version.plan.code !== "PAYG"
      ) || (
        paygRequestsEnabled
        && version.pricingMode === "USAGE_PER_STALL_CAPPED"
        && version.plan.code === "PAYG"
      ))
      .map((version) => ({
        ...version,
        entitlements: resolvePlanEntitlements(version).filter((entitlement) => entitlement.isEnabled),
      })),
    orderPackages,
    paygStallUsage,
  };
}

export function billingPeriodMonthStartInTaipei(value: Date) {
  const parts = new Map(
    taipeiBillingDateFormatter.formatToParts(value).map((part) => [part.type, part.value]),
  );
  return new Date(Date.UTC(Number(parts.get("year")), Number(parts.get("month")) - 1, 1));
}

export async function getInvoiceForMerchant(organizationId: string, invoiceId: string) {
  return prisma.invoice.findFirst({
    where: { id: invoiceId, organizationId },
    include: {
      lineItems: { orderBy: { createdAt: "asc" } },
      manualPayments: { orderBy: { createdAt: "desc" } },
      subscription: { include: { planVersion: true } },
    },
  });
}
