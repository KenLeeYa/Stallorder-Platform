import type { FulfillmentType, OrderItemStatus, OrderStatus, PaymentStatus, Prisma } from "@prisma/client";
import {
  resolveFulfillmentTimeReadModel,
  type FulfillmentTimeState,
} from "@/lib/fulfillment-time";

export const activeOrderStatuses = ["WAITING_CONFIRMATION", "CONFIRMED", "PREPARING", "PACKING", "READY"] as const;

export const staffOrderSelect = {
  id: true,
  orderNo: true,
  source: true,
  isTest: true,
  customerName: true,
  customerPhone: true,
  deliveryAddress: true,
  tableLabel: true,
  diningTableId: true,
  fulfillmentType: true,
  note: true,
  status: true,
  paymentStatus: true,
  subtotal: true,
  discountAmount: true,
  discountLabel: true,
  total: true,
  pickupCodeLength: true,
  pickupVerifiedAt: true,
  pickupVerificationMethod: true,
  confirmationExpiresAt: true,
  quotedWaitMinutes: true,
  quotedReadyAt: true,
  scheduledPickupAt: true,
  requestedFulfillmentAt: true,
  committedFulfillmentAt: true,
  pendingFulfillmentAt: true,
  fulfillmentTimeState: true,
  fulfillmentTimeVersion: true,
  fulfillmentTimeResponseExpiresAt: true,
  fulfillmentTimeChangeReason: true,
  createdAt: true,
  items: {
    select: {
      id: true,
      name: true,
      unitPrice: true,
      quantity: true,
      isOrderDiscountEligible: true,
      note: true,
      status: true,
      preparingAt: true,
      readyAt: true,
      servedAt: true,
      noteOptions: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { groupName: true, optionName: true, priceDelta: true },
      },
    },
  },
} satisfies Prisma.OrderSelect;

export type StaffOrderDto = {
  id: string;
  orderNo: string;
  source: string;
  isTest: boolean;
  customerName: string;
  customerPhone: string | null;
  deliveryAddress: string | null;
  tableLabel: string | null;
  diningTableId: string | null;
  fulfillmentType: FulfillmentType;
  note: string | null;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  subtotal: number;
  discountAmount: number;
  discountLabel: string | null;
  total: number;
  pickupCodeLength: number;
  pickupVerifiedAt: string | null;
  pickupVerificationMethod: "CODE" | "MANUAL" | null;
  confirmationExpiresAt: string;
  quotedWaitMinutes: number | null;
  quotedReadyAt: string | null;
  scheduledPickupAt: string | null;
  requestedFulfillmentAt: string | null;
  committedFulfillmentAt: string | null;
  pendingFulfillmentAt: string | null;
  fulfillmentTimeState: FulfillmentTimeState;
  fulfillmentTimeVersion: number;
  fulfillmentTimeResponseExpiresAt: string | null;
  fulfillmentTimeChangeReason: string | null;
  createdAt: string;
  items: Array<{
    id: string;
    name: string;
    unitPrice: number;
    quantity: number;
    isOrderDiscountEligible: boolean;
    note: string | null;
    status: OrderItemStatus;
    preparingAt: string | null;
    readyAt: string | null;
    servedAt: string | null;
    noteOptions: Array<{ groupName: string; optionName: string; priceDelta: number }>;
  }>;
};

export function serializeStaffOrder(order: Prisma.OrderGetPayload<{ select: typeof staffOrderSelect }>): StaffOrderDto {
  const scheduledPickupAt = order.scheduledPickupAt?.toISOString() ?? null;
  const requestedFulfillmentAt = order.requestedFulfillmentAt?.toISOString() ?? null;
  const committedFulfillmentAt = order.committedFulfillmentAt?.toISOString() ?? null;
  const pendingFulfillmentAt = order.pendingFulfillmentAt?.toISOString() ?? null;
  const fulfillmentTime = resolveFulfillmentTimeReadModel({
    source: order.source,
    fulfillmentType: order.fulfillmentType,
    scheduledPickupAt,
    requestedFulfillmentAt,
    committedFulfillmentAt,
    pendingFulfillmentAt,
    fulfillmentTimeState: order.fulfillmentTimeState as FulfillmentTimeState,
    fulfillmentTimeVersion: order.fulfillmentTimeVersion,
  });

  return {
    ...order,
    pickupVerifiedAt: order.pickupVerifiedAt?.toISOString() ?? null,
    pickupVerificationMethod: order.pickupVerificationMethod === "CODE"
      ? "CODE"
      : order.pickupVerificationMethod === "MANUAL" ? "MANUAL" : null,
    confirmationExpiresAt: order.confirmationExpiresAt.toISOString(),
    quotedReadyAt: order.quotedReadyAt?.toISOString() ?? null,
    scheduledPickupAt,
    requestedFulfillmentAt: fulfillmentTime.requestedFulfillmentAt,
    committedFulfillmentAt: fulfillmentTime.committedFulfillmentAt,
    pendingFulfillmentAt,
    fulfillmentTimeState: fulfillmentTime.fulfillmentTimeState,
    fulfillmentTimeResponseExpiresAt: order.fulfillmentTimeResponseExpiresAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    items: order.items.map((item) => ({
      ...item,
      preparingAt: item.preparingAt?.toISOString() ?? null,
      readyAt: item.readyAt?.toISOString() ?? null,
      servedAt: item.servedAt?.toISOString() ?? null,
    })),
  };
}

export const staffStatusOptions = [
  { value: "CONFIRMED", label: "確認接單" },
  { value: "PREPARING", label: "開始製作" },
  { value: "PACKING", label: "包裝中" },
  { value: "READY", label: "可取餐" },
  { value: "COMPLETED", label: "完成訂單" },
  { value: "CANCELLED", label: "取消訂單" },
] as const;

export const orderStatusLabels = {
  WAITING_CONFIRMATION: "待確認",
  CONFIRMED: "已確認",
  PREPARING: "製作中",
  PACKING: "包裝中",
  READY: "可取餐",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
  EXPIRED: "確認逾時",
} as const;

export const paymentStatusLabels = {
  UNPAID: "未付款",
  PENDING_RECONCILIATION: "待對帳",
  PAID: "已付款",
  REFUNDED: "已退款",
} as const;

export const orderItemStatusLabels = {
  PENDING: "待製作",
  PREPARING: "製作中",
  READY: "已完成餐點",
  SERVED: "已出餐",
} as const;
