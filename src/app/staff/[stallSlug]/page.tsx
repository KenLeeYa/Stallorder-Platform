import { prisma } from "@/lib/prisma";
import { activeOrderStatuses, serializeStaffOrder, staffOrderSelect } from "@/lib/orders";
import { requirePagePermission } from "@/lib/authorization";
import { hasPermission } from "@/lib/rbac";
import { getStaffOrderCatalog } from "@/lib/staff-order-catalog";
import { StaffOrderBoard } from "@/components/staff-order-board";
import { FeatureUpgradeNotice } from "@/components/feature-upgrade-notice";
import { getFeatureAccess } from "@/server/billing/feature-access";

type PageProps = {
  params: Promise<{ stallSlug: string }>;
};

export default async function StaffPage({ params }: PageProps) {
  const { stallSlug } = await params;
  const { stall, principal, role } = await requirePagePermission(
    stallSlug,
    "VIEW_ORDERS",
    `/staff/${stallSlug}`,
  );
  if (role === "KITCHEN") {
    const access = await getFeatureAccess(stall.organizationId, "KITCHEN_VIEW", {
      requireUsableSubscription: false,
    });
    if (!access.allowed) {
      return <FeatureUpgradeNotice title="廚房檢視尚未開放" message={access.message} />;
    }
  }
  await prisma.$queryRaw`select public.expire_unconfirmed_orders()`;
  const statuses = role === "KITCHEN"
    ? activeOrderStatuses.filter((status) => status !== "WAITING_CONFIRMATION")
    : activeOrderStatuses;
  const [orders, settings, paymentOptions, discountOptions, orderCatalog, serverClock] = await Promise.all([
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
  ]);

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
