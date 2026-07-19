import { Suspense } from "react";
import { RouteLoadingSkeleton } from "@/components/route-loading-skeleton";
import { StaffOrderBoard } from "@/components/staff-order-board";
import { requirePagePermission } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { activeOrderStatuses, serializeStaffOrder, staffOrderSelect } from "@/lib/orders";
import { hasPermission } from "@/lib/rbac";
import { getStaffOrderCatalog } from "@/lib/staff-order-catalog";
import { FeatureUpgradeNotice } from "@/components/feature-upgrade-notice";
import { getFeatureAccess } from "@/server/billing/feature-access";
import { createPerformanceTiming } from "@/lib/performance-timing";
import { createRequestId } from "@/lib/security";

type PageProps = {
  params: Promise<{ stallSlug: string }>;
};

export default async function StaffPage({ params }: PageProps) {
  const requestId = createRequestId();
  const timing = createPerformanceTiming({ route: "/staff/:stallSlug", requestId });
  const { stallSlug } = await params;
  const authorization = await timing.measure(
    "authMs",
    () => timing.measureDb(
      () => requirePagePermission(stallSlug, "VIEW_ORDERS", `/staff/${stallSlug}`),
      4,
    ),
  );
  if (authorization.role === "KITCHEN") {
    const access = await timing.measureDb(() => getFeatureAccess(
      authorization.stall.organizationId,
      "KITCHEN_VIEW",
      {
      requireUsableSubscription: false,
      },
    ));
    if (!access.allowed) {
      timing.finish({ status: 200 });
      return <FeatureUpgradeNotice title="廚房檢視尚未開放" message={access.message} />;
    }
  }
  return (
    <Suspense fallback={<RouteLoadingSkeleton variant="orders" />}>
      <StaffOrderContent {...authorization} timing={timing} />
    </Suspense>
  );
}

type StaffOrderContentProps = Awaited<ReturnType<typeof requirePagePermission>> & {
  timing: ReturnType<typeof createPerformanceTiming>;
};

async function StaffOrderContent({ stall, principal, role, timing }: StaffOrderContentProps) {
  const statuses = role === "KITCHEN"
    ? activeOrderStatuses.filter((status) => status !== "WAITING_CONFIRMATION")
    : activeOrderStatuses;
  const [orders, settings, paymentOptions, discountOptions, orderCatalog, serverClock] = await timing.measureDb(() => Promise.all([
    prisma.order.findMany({
      where: {
        stallId: stall.id,
        status: { in: [...statuses] },
      },
      orderBy: { createdAt: "asc" },
      select: staffOrderSelect,
    }),
    prisma.stallOrderingSettings.findUnique({
      where: { stallId: stall.id },
      select: {
        dineInEnabled: true,
        deliveryModuleEnabled: true,
        printModuleEnabled: true,
        paymentModuleEnabled: true,
        discountModuleEnabled: true,
        discountApprovalThresholdBps: true,
      },
    }),
    prisma.paymentOption.findMany({
      where: { stallId: stall.id, organizationId: stall.organizationId, isEnabled: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, kind: true },
    }),
    prisma.discountOption.findMany({
      where: { stallId: stall.id, organizationId: stall.organizationId, isEnabled: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, rateBps: true },
    }),
    hasPermission(role, "CREATE_ORDERS")
      ? getStaffOrderCatalog(stall.id, stall.organizationId)
      : Promise.resolve(null),
    prisma.$queryRaw<Array<{ now: Date }>>`select now() as now`,
  ]), 6);
  timing.finish({ status: 200 });

  return (
    <StaffOrderBoard
      stall={{ id: stall.id, slug: stall.slug, name: stall.name, currency: stall.currency }}
      initialOrders={orders.map(serializeStaffOrder)}
      initialNow={serverClock[0].now.getTime()}
      account={{ displayName: principal.user.displayName, role }}
      modules={{
        dineIn: settings?.dineInEnabled ?? false,
        delivery: settings?.deliveryModuleEnabled ?? false,
        print: settings?.printModuleEnabled ?? false,
        payment: settings?.paymentModuleEnabled ?? false,
        discount: settings?.discountModuleEnabled ?? false,
        discountApprovalThresholdBps: settings?.discountApprovalThresholdBps ?? 8000,
      }}
      paymentOptions={paymentOptions}
      discountOptions={discountOptions}
      orderCatalog={orderCatalog}
    />
  );
}
