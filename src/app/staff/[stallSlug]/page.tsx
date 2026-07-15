import { prisma } from "@/lib/prisma";
import { activeOrderStatuses } from "@/lib/orders";
import { requirePagePermission } from "@/lib/authorization";
import { StaffOrderBoard } from "@/components/staff-order-board";

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
  await prisma.$queryRaw`select public.expire_unconfirmed_orders()`;
  const statuses = role === "KITCHEN"
    ? activeOrderStatuses.filter((status) => status !== "WAITING_CONFIRMATION")
    : activeOrderStatuses;
  const [orders, settings, paymentOptions, discountOptions] = await Promise.all([
    prisma.order.findMany({
      where: {
        stallId: stall.id,
        status: { in: [...statuses] },
      },
      orderBy: { createdAt: "asc" },
      include: {
        items: {
          include: { noteOptions: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
        },
      },
    }),
    prisma.stallOrderingSettings.findUnique({
      where: { stallId: stall.id },
      select: {
        printModuleEnabled: true,
        paymentModuleEnabled: true,
        discountModuleEnabled: true,
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
  ]);

  return (
    <StaffOrderBoard
      stall={{ id: stall.id, slug: stall.slug, name: stall.name, currency: stall.currency }}
      initialOrders={orders.map((order) => ({
        id: order.id,
        orderNo: order.orderNo,
        source: order.source,
        customerName: order.customerName,
        tableLabel: order.tableLabel,
        fulfillmentType: order.fulfillmentType,
        note: order.note,
        status: order.status,
        paymentStatus: order.paymentStatus,
        subtotal: order.subtotal,
        discountAmount: order.discountAmount,
        discountLabel: order.discountLabel,
        total: order.total,
        pickupVerifiedAt: order.pickupVerifiedAt?.toISOString() ?? null,
        confirmationExpiresAt: order.confirmationExpiresAt.toISOString(),
        createdAt: order.createdAt.toISOString(),
        items: order.items.map((item) => ({
          id: item.id,
          name: item.name,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          note: item.note,
          noteOptions: item.noteOptions.map((noteOption) => ({
            groupName: noteOption.groupName,
            optionName: noteOption.optionName,
            priceDelta: noteOption.priceDelta,
          })),
          status: item.status,
          preparingAt: item.preparingAt?.toISOString() ?? null,
          readyAt: item.readyAt?.toISOString() ?? null,
          servedAt: item.servedAt?.toISOString() ?? null,
        })),
      }))}
      account={{ displayName: principal.user.displayName, role }}
      modules={{
        print: settings?.printModuleEnabled ?? false,
        payment: settings?.paymentModuleEnabled ?? false,
        discount: settings?.discountModuleEnabled ?? false,
      }}
      paymentOptions={paymentOptions}
      discountOptions={discountOptions}
    />
  );
}
