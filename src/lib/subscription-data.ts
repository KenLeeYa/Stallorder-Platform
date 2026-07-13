import "server-only";

import { calculateBillingEstimate } from "@/lib/billing";
import { prisma } from "@/lib/prisma";

export async function getSubscriptionOverview(organizationId: string) {
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId },
    include: {
      plan: true,
      additionalApprovals: {
        where: { status: "APPROVED", effectiveAt: { lte: new Date() }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        orderBy: { effectiveAt: "asc" },
      },
      invoices: {
        orderBy: { createdAt: "desc" },
        take: 12,
        include: { lineItems: { orderBy: { createdAt: "asc" } } },
      },
    },
  });
  if (!subscription) return null;

  const [activeStalls, qrCodeCount, orderUsage, csvUsage, staffCountRows] = await Promise.all([
    prisma.stall.count({ where: { organizationId, isActive: true } }),
    prisma.qrCode.count({ where: { organizationId } }),
    prisma.usageEvent.aggregate({
      where: { organizationId, billingPeriod: subscription.billingPeriodStart, eventType: "ORDER_CREATED" },
      _sum: { quantity: true },
    }),
    prisma.usageEvent.aggregate({
      where: { organizationId, billingPeriod: subscription.billingPeriodStart, eventType: "CSV_EXPORTED" },
      _sum: { quantity: true },
    }),
    prisma.$queryRaw<Array<{ count: bigint }>>`
      select count(distinct membership.profile_id)::bigint as count
      from (
        select profile_id from public.organization_memberships
        where organization_id = ${organizationId}::uuid and is_active
        union
        select profile_id from public.stall_memberships
        where organization_id = ${organizationId}::uuid and is_active
      ) membership
    `,
  ]);
  const orderCount = orderUsage._sum.quantity ?? 0;
  const estimate = calculateBillingEstimate({
    basePrice: subscription.plan.basePrice,
    activeStalls,
    includedStalls: subscription.plan.includedStalls,
    defaultAdditionalStallPrice: subscription.plan.additionalStallPrice,
    approvals: subscription.additionalApprovals.map((approval) => ({ quantity: approval.quantity, unitPrice: approval.unitPrice })),
    orderCount,
    includedOrders: subscription.plan.includedOrders,
    excessOrderPrice: subscription.plan.excessOrderPrice,
  });

  return {
    subscription,
    usage: {
      orderCount,
      activeStallCount: activeStalls,
      staffCount: Number(staffCountRows[0]?.count ?? 0),
      qrCodeCount,
      csvExportCount: csvUsage._sum.quantity ?? 0,
    },
    estimate,
  };
}
