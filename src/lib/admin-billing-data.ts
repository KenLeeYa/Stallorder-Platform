import "server-only";

import { prisma } from "@/lib/prisma";
import { resolvePlanEntitlements } from "@/server/billing/entitlement-service";

export async function getAdminBillingOverview() {
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const [
    activeSubscriptions,
    trialingSubscriptions,
    pastDueSubscriptions,
    suspendedSubscriptions,
    paidInvoices,
    openInvoices,
    overdueInvoices,
    invoiced,
    collected,
    trialConversions,
    pendingRequests,
    pendingPayments,
  ] = await Promise.all([
    prisma.subscription.count({ where: { status: "ACTIVE" } }),
    prisma.subscription.count({ where: { status: "TRIALING" } }),
    prisma.subscription.count({ where: { status: "PAST_DUE" } }),
    prisma.subscription.count({ where: { status: "SUSPENDED" } }),
    prisma.invoice.count({ where: { status: "PAID" } }),
    prisma.invoice.count({ where: { status: "OPEN" } }),
    prisma.invoice.count({ where: { status: "OVERDUE" } }),
    prisma.invoice.aggregate({
      where: { issuedAt: { gte: monthStart }, status: { notIn: ["DRAFT", "VOID", "CANCELLED"] } },
      _sum: { totalAmount: true },
    }),
    prisma.manualPaymentRecord.aggregate({
      where: { verificationStatus: "VERIFIED", verifiedAt: { gte: monthStart } },
      _sum: { amount: true },
    }),
    prisma.subscription.count({ where: { status: "ACTIVE", trialStartedAt: { not: null } } }),
    prisma.billingChangeRequest.findMany({
      where: { status: "PENDING" },
      include: {
        organization: true,
        subscription: { include: { planVersion: true } },
        requestedPlanVersion: { include: { plan: true } },
        requestedBy: { select: { displayName: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 100,
    }),
    prisma.manualPaymentRecord.findMany({
      where: { verificationStatus: "PENDING_VERIFICATION" },
      include: { organization: true, invoice: true, recordedBy: { select: { displayName: true } } },
      orderBy: { createdAt: "asc" },
      take: 100,
    }),
  ]);

  return {
    metrics: {
      activeSubscriptions,
      trialingSubscriptions,
      pastDueSubscriptions,
      suspendedSubscriptions,
      paidInvoices,
      openInvoices,
      overdueInvoices,
      monthlyInvoiced: invoiced._sum.totalAmount ?? 0,
      monthlyCollected: collected._sum.amount ?? 0,
      trialConversions,
    },
    pendingRequests,
    pendingPayments,
  };
}

export function getAdminSubscriptions() {
  return prisma.subscription.findMany({
    include: {
      organization: {
        include: {
          billingUsageSummaries: { orderBy: { billingPeriod: "desc" }, take: 1 },
        },
      },
      planVersion: true,
      _count: { select: { invoices: true, items: true } },
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  });
}

export function getAdminSubscription(subscriptionId: string) {
  return prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: {
      organization: { include: { billingUsageSummaries: { orderBy: { billingPeriod: "desc" }, take: 12 } } },
      plan: true,
      planVersion: { include: { entitlements: { orderBy: { featureCode: "asc" } } } },
      items: { orderBy: { createdAt: "desc" } },
      additionalApprovals: { orderBy: { createdAt: "desc" } },
      invoices: { orderBy: { createdAt: "desc" }, take: 20 },
      billingChangeRequests: {
        include: { requestedPlanVersion: true, requestedBy: { select: { displayName: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

export function getAdminInvoices() {
  return prisma.invoice.findMany({
    include: {
      organization: true,
      subscription: { include: { planVersion: true } },
      _count: { select: { manualPayments: true, lineItems: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 250,
  });
}

export function getAdminInvoice(invoiceId: string) {
  return prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      organization: true,
      subscription: { include: { planVersion: true } },
      lineItems: { orderBy: { createdAt: "asc" } },
      manualPayments: {
        include: {
          recordedBy: { select: { displayName: true } },
          verifiedBy: { select: { displayName: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

export function getAdminPayments() {
  return prisma.manualPaymentRecord.findMany({
    include: {
      organization: true,
      invoice: true,
      recordedBy: { select: { displayName: true } },
      verifiedBy: { select: { displayName: true } },
    },
    orderBy: [{ verificationStatus: "asc" }, { createdAt: "desc" }],
    take: 250,
  });
}

export async function getAdminPlanCatalog() {
  const [plans, versions, addOns, featureFlags] = await Promise.all([
    prisma.plan.findMany({ include: { _count: { select: { versions: true, subscriptions: true } } }, orderBy: { basePrice: "asc" } }),
    prisma.planVersion.findMany({
      include: { plan: true, entitlements: { orderBy: { featureCode: "asc" } }, _count: { select: { subscriptions: true } } },
      orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
    }),
    prisma.addOnCatalog.findMany({ orderBy: [{ availabilityStatus: "asc" }, { unitPrice: "asc" }] }),
    prisma.billingFeatureFlag.findMany({ orderBy: [{ phase: "asc" }, { code: "asc" }] }),
  ]);
  return {
    plans,
    versions: versions.map((version) => ({
      ...version,
      entitlements: resolvePlanEntitlements(version),
    })),
    addOns,
    featureFlags,
  };
}

export function getAdminUsage() {
  return prisma.billingUsageSummary.findMany({
    include: {
      organization: { include: { subscription: { include: { planVersion: true } } } },
    },
    orderBy: [{ billingPeriod: "desc" }, { billableOrderCount: "desc" }],
    take: 500,
  });
}
