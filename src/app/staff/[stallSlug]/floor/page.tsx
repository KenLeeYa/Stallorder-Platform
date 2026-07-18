import { notFound } from "next/navigation";
import { DiningFloorBoard } from "@/components/dining-floor-board";
import { FeatureUpgradeNotice } from "@/components/feature-upgrade-notice";
import { requirePagePermission } from "@/lib/authorization";
import { activeOrderStatuses } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { getFeatureAccess } from "@/server/billing/feature-access";

type PageProps = {
  params: Promise<{ stallSlug: string }>;
};

export default async function DiningFloorPage({ params }: PageProps) {
  const { stallSlug } = await params;
  const { stall, principal, role } = await requirePagePermission(
    stallSlug,
    "VIEW_DINING_FLOOR",
    `/staff/${stallSlug}/floor`,
  );

  if (role === "KITCHEN") {
    const access = await getFeatureAccess(stall.organizationId, "KITCHEN_VIEW", {
      requireUsableSubscription: false,
    });
    if (!access.allowed) {
      return <FeatureUpgradeNotice title="廚房桌位檢視尚未開放" message={access.message} />;
    }
  }

  const settings = await prisma.stallOrderingSettings.findUnique({
    where: { stallId: stall.id },
    select: { dineInEnabled: true },
  });
  if (!settings?.dineInEnabled) notFound();

  await prisma.$queryRaw`select public.expire_unconfirmed_orders()`;
  const statuses = role === "KITCHEN"
    ? activeOrderStatuses.filter((status) => status !== "WAITING_CONFIRMATION")
    : activeOrderStatuses;
  const [tables, orders] = await Promise.all([
    prisma.diningTable.findMany({
      where: { stallId: stall.id, organizationId: stall.organizationId },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: {
        id: true,
        code: true,
        label: true,
        isActive: true,
        layoutX: true,
        layoutY: true,
        serviceState: true,
        seatedAt: true,
        cleanedAt: true,
      },
    }),
    prisma.order.findMany({
      where: {
        stallId: stall.id,
        fulfillmentType: "DINE_IN",
        diningTableId: { not: null },
        status: { in: [...statuses] },
      },
      orderBy: { createdAt: "asc" },
      take: 50,
      select: {
        id: true,
        orderNo: true,
        customerName: true,
        diningTableId: true,
        tableLabel: true,
        fulfillmentType: true,
        status: true,
        createdAt: true,
        items: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            name: true,
            quantity: true,
            note: true,
            status: true,
            noteOptions: {
              orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
              select: { groupName: true, optionName: true },
            },
          },
        },
      },
    }),
  ]);

  return (
    <DiningFloorBoard
      stall={{ slug: stall.slug, name: stall.name }}
      tables={tables.map((table) => ({
        ...table,
        seatedAt: table.seatedAt?.toISOString() ?? null,
        cleanedAt: table.cleanedAt?.toISOString() ?? null,
      }))}
      initialOrders={orders.map((order) => ({
        ...order,
        fulfillmentType: "DINE_IN" as const,
        createdAt: order.createdAt.toISOString(),
      }))}
      account={{ displayName: principal.user.displayName, role }}
    />
  );
}
