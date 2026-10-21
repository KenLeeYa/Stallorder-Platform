import "server-only";

import type { Prisma } from "@prisma/client";

export const mobileOrderSummarySelect = {
  id: true,
  orderNo: true,
  status: true,
  paymentStatus: true,
  fulfillmentType: true,
  customerName: true,
  tableLabel: true,
  total: true,
  isTest: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { items: true } },
} satisfies Prisma.OrderSelect;

export const mobileOrderDetailSelect = {
  ...mobileOrderSummarySelect,
  source: true,
  note: true,
  items: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      unitPrice: true,
      quantity: true,
      note: true,
      status: true,
      noteOptions: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { groupName: true, optionName: true, priceDelta: true },
      },
    },
  },
} satisfies Prisma.OrderSelect;

type MobileOrderSummaryRecord = Prisma.OrderGetPayload<{ select: typeof mobileOrderSummarySelect }>;
type MobileOrderDetailRecord = Prisma.OrderGetPayload<{ select: typeof mobileOrderDetailSelect }>;

export function serializeMobileOrderSummary(order: MobileOrderSummaryRecord) {
  const { _count, ...summary } = order;
  return {
    ...summary,
    itemCount: _count.items,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

export function serializeMobileOrderDetail(order: MobileOrderDetailRecord) {
  const { _count, ...detail } = order;
  return {
    ...detail,
    itemCount: _count.items,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}
