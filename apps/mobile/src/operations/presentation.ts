import type { MobileOrderListResponse, MobileOrderStatus } from "@stallorder/contracts/mobile/v1";

export const activeMobileOrderStatuses: MobileOrderStatus[] = [
  "WAITING_CONFIRMATION",
  "CONFIRMED",
  "PREPARING",
  "PACKING",
  "READY",
];

export const mobileOrderStatusLabels: Record<MobileOrderStatus, string> = {
  WAITING_CONFIRMATION: "待確認",
  CONFIRMED: "已確認",
  PREPARING: "製作中",
  PACKING: "包裝中",
  READY: "可取餐",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
  EXPIRED: "確認逾時",
};

export const mobilePaymentStatusLabels = {
  UNPAID: "未付款",
  PAID: "已付款",
  REFUNDED: "已退款",
  PENDING_RECONCILIATION: "待對帳",
} as const;

export const mobileFulfillmentTypeLabels = {
  TAKEOUT: "外帶",
  DINE_IN: "內用",
  DELIVERY: "外送",
} as const;

export const mobileOrderItemStatusLabels = {
  PENDING: "待製作",
  PREPARING: "製作中",
  READY: "已完成",
  SERVED: "已出餐",
} as const;

export function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

type MobileOrderSummary = MobileOrderListResponse["orders"][number];

export function deduplicateAuthoritativeOrders(orders: MobileOrderSummary[]) {
  const newestById = new Map<string, MobileOrderSummary>();
  for (const order of orders) {
    const current = newestById.get(order.id);
    if (!current || Date.parse(order.updatedAt) > Date.parse(current.updatedAt)) {
      newestById.set(order.id, order);
    }
  }
  return [...newestById.values()].sort((left, right) => (
    Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    || right.id.localeCompare(left.id)
  ));
}
