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
  const orders = await prisma.order.findMany({
    where: {
      stallId: stall.id,
      status: { in: [...statuses] },
    },
    orderBy: { createdAt: "asc" },
    include: { items: true },
  });

  return (
    <StaffOrderBoard
      stall={{ id: stall.id, slug: stall.slug, name: stall.name, currency: stall.currency }}
      initialOrders={orders.map((order) => ({
        id: order.id,
        orderNo: order.orderNo,
        source: order.source,
        customerName: order.customerName,
        tableLabel: order.tableLabel,
        note: order.note,
        status: order.status,
        paymentStatus: order.paymentStatus,
        total: order.total,
        pickupVerifiedAt: order.pickupVerifiedAt?.toISOString() ?? null,
        confirmationExpiresAt: order.confirmationExpiresAt.toISOString(),
        createdAt: order.createdAt.toISOString(),
        items: order.items.map((item) => ({
          id: item.id,
          name: item.name,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
        })),
      }))}
      account={{ displayName: principal.user.displayName, role }}
    />
  );
}
