import type { Prisma } from "@prisma/client";

export const activeOrderStatuses = ["WAITING_CONFIRMATION", "CONFIRMED", "PREPARING", "READY"] as const;

export const staffOrderSelect = {
  id: true,
  orderNo: true,
  source: true,
  customerName: true,
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
  createdAt: true,
  items: {
    select: {
      id: true,
      name: true,
      unitPrice: true,
      quantity: true,
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

export const staffStatusOptions = [
  { value: "CONFIRMED", label: "確認接單" },
  { value: "PREPARING", label: "開始製作" },
  { value: "READY", label: "可取餐" },
  { value: "COMPLETED", label: "完成訂單" },
  { value: "CANCELLED", label: "取消訂單" },
] as const;

export const orderStatusLabels = {
  WAITING_CONFIRMATION: "待確認",
  CONFIRMED: "已確認",
  PREPARING: "製作中",
  READY: "可取餐",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
  EXPIRED: "確認逾時",
} as const;

export const paymentStatusLabels = {
  UNPAID: "未付款",
  PAID: "已付款",
  REFUNDED: "已退款",
} as const;

export const orderItemStatusLabels = {
  PENDING: "待製作",
  PREPARING: "製作中",
  READY: "已完成餐點",
  SERVED: "已出餐",
} as const;
