import { Suspense } from "react";
import { RouteLoadingSkeleton } from "@/components/route-loading-skeleton";
import { StaffOrderBoard } from "@/components/staff-order-board";
import { requirePagePermission } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { activeOrderStatuses, serializeStaffOrder, staffOrderSelect } from "@/lib/orders";
import { hasPermission } from "@/lib/rbac";
import { getStaffOrderPageConfiguration } from "@/lib/staff-order-catalog";
import { createPerformanceTiming } from "@/lib/performance-timing";
import { createRequestId } from "@/lib/security";
import { getStaffCapacityData } from "@/lib/capacity";
import { getServerNowMs } from "@/lib/server-clock";
import { buildWorkModeDestinations } from "@/lib/work-mode";
import { getWorkspaceAccess } from "@/lib/workspace";

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
  return (
    <Suspense fallback={<RouteLoadingSkeleton variant="orders" />}>
      <StaffOrderContent {...authorization} timing={timing} />
    </Suspense>
  );
}

type StaffOrderContentProps = Awaited<ReturnType<typeof requirePagePermission>> & {
  timing: ReturnType<typeof createPerformanceTiming>;
};

async function StaffOrderContent({ stall, principal, role, roles, timing }: StaffOrderContentProps) {
  const canCreateOrders = hasPermission(role, "CREATE_ORDERS");
  const canOperateCapacity = roles.some((candidate) => hasPermission(candidate, "OPERATE_CAPACITY"));
  const dataQueryCount = 3
    + (canCreateOrders ? 3 : 1)
    + (canOperateCapacity ? 3 : 0)
    + 3;
  const [orders, paymentOptions, discountOptions, configuration, capacity, workspaces] = await timing.measureDb(() => Promise.all([
    prisma.order.findMany({
      where: {
        stallId: stall.id,
        status: { in: [...activeOrderStatuses] },
      },
      orderBy: { createdAt: "asc" },
      select: staffOrderSelect,
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
    getStaffOrderPageConfiguration(
      stall.id,
      stall.organizationId,
      canCreateOrders,
    ),
    canOperateCapacity
      ? getStaffCapacityData(stall.organizationId, stall.id)
      : Promise.resolve(null),
    getWorkspaceAccess(principal.user.id, principal.user.platformRole),
  ]), dataQueryCount);
  const serverNow = getServerNowMs();
  timing.finish({ status: 200 });
  const workModeDestinations = buildWorkModeDestinations(workspaces);

  return (
    <StaffOrderBoard
      stall={{
        id: stall.id,
        organizationId: stall.organizationId,
        slug: stall.slug,
        name: stall.name,
        currency: stall.currency,
        timezone: stall.timezone,
        businessDayCutoffHour: configuration.businessDayCutoffHour,
      }}
      initialOrders={orders.map(serializeStaffOrder)}
      initialNow={serverNow}
      account={{ displayName: principal.user.displayName, role }}
      modules={configuration.modules}
      paymentOptions={paymentOptions}
      discountOptions={discountOptions}
      orderCatalog={configuration.catalog}
      capacity={capacity}
      workModeDestinations={workModeDestinations}
      appVersion={(process.env.VERCEL_GIT_COMMIT_SHA ?? "web").slice(0, 40)}
    />
  );
}
