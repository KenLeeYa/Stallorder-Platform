import "server-only";

import { prisma } from "@/lib/prisma";
import {
  entitlementService,
  resolvePlanEntitlements,
} from "@/server/billing/entitlement-service";

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
  const [usage, warnings, effectiveEntitlements, notifications, availablePlans, orderPackages] = await Promise.all([
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
    prisma.addOnCatalog.findMany({
      where: { isActive: true, isPublic: true, code: { startsWith: "ORDER_PACKAGE_" } },
      orderBy: { unitPrice: "asc" },
    }),
  ]);
  return {
    subscription,
    usage,
    warnings,
    effectiveEntitlements,
    notifications,
    availablePlans: availablePlans.map((version) => ({
      ...version,
      entitlements: resolvePlanEntitlements(version).filter((entitlement) => entitlement.isEnabled),
    })),
    orderPackages,
  };
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
