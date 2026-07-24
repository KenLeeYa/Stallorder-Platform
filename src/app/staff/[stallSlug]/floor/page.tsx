import { notFound } from "next/navigation";
import { DiningFloorBoard } from "@/components/dining-floor-board";
import { requirePagePermission } from "@/lib/authorization";
import { activeOrderStatuses } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

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

  const settings = await prisma.stallOrderingSettings.findUnique({
    where: { stallId: stall.id },
    select: { dineInEnabled: true },
  });
  if (!settings?.dineInEnabled) notFound();

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
        status: { in: [...activeOrderStatuses] },
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
