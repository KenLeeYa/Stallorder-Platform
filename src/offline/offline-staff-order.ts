import type { OrderItemStatus, OrderStatus, PaymentStatus } from "@prisma/client";
import type { StaffOrderDto } from "@/lib/orders";
import type { OfflineOrder, OfflineOrderState } from "@/offline/offline-order-contract";

const statusMap: Record<OfflineOrderState, OrderStatus> = {
  LOCAL_NEW: "CONFIRMED",
  LOCAL_CONFIRMED: "CONFIRMED",
  LOCAL_PREPARING: "PREPARING",
  LOCAL_READY: "READY",
  LOCAL_COMPLETED: "COMPLETED",
  LOCAL_CANCELLED: "CANCELLED",
};

const itemStatusMap: Record<OfflineOrderState, OrderItemStatus> = {
  LOCAL_NEW: "PENDING",
  LOCAL_CONFIRMED: "PENDING",
  LOCAL_PREPARING: "PREPARING",
  LOCAL_READY: "READY",
  LOCAL_COMPLETED: "SERVED",
  LOCAL_CANCELLED: "PENDING",
};

const paymentStatusMap: Record<OfflineOrder["paymentStatus"], PaymentStatus> = {
  UNPAID: "UNPAID",
  PAID_LOCAL: "PAID",
  PENDING_RECONCILIATION: "PENDING_RECONCILIATION",
};

export function offlineOrderToStaffOrder(order: OfflineOrder): StaffOrderDto {
  const status = statusMap[order.orderStatus];
  const itemStatus = itemStatusMap[order.orderStatus];
  return {
    id: order.offlineOrderId,
    orderNo: order.localDisplayNumber,
    source: "OFFLINE_POS",
    isTest: false,
    customerName: order.customerLabel || "現場顧客",
    customerPhone: order.customerContact || null,
    deliveryAddress: null,
    tableLabel: null,
    diningTableId: null,
    fulfillmentType: "TAKEOUT",
    note: order.note || null,
    status,
    paymentStatus: paymentStatusMap[order.paymentStatus],
    subtotal: order.subtotal,
    discountAmount: 0,
    discountLabel: null,
    total: order.total,
    pickupCodeLength: 3,
    pickupVerifiedAt: null,
    pickupVerificationMethod: null,
    confirmationExpiresAt: order.createdAtDevice,
    quotedWaitMinutes: null,
    quotedReadyAt: null,
    scheduledPickupAt: null,
    requestedFulfillmentAt: null,
    committedFulfillmentAt: null,
    pendingFulfillmentAt: null,
    fulfillmentTimeState: "NOT_REQUESTED",
    fulfillmentTimeVersion: 0,
    fulfillmentTimeResponseExpiresAt: null,
    fulfillmentTimeChangeReason: null,
    createdAt: order.createdAtDevice,
    primaryPrintStatus: null,
    items: order.itemsSnapshot.map((item) => ({
      id: item.localItemId,
      name: item.name,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      isOrderDiscountEligible: true,
      note: item.note || null,
      status: itemStatus,
      preparingAt: order.orderStatus === "LOCAL_PREPARING"
        ? order.updatedAtDevice
        : null,
      readyAt: order.orderStatus === "LOCAL_READY"
        || order.orderStatus === "LOCAL_COMPLETED"
        ? order.updatedAtDevice
        : null,
      servedAt: order.orderStatus === "LOCAL_COMPLETED"
        ? order.updatedAtDevice
        : null,
      noteOptions: item.noteOptions.map((option) => ({
        groupName: option.groupName,
        optionName: option.optionName,
        priceDelta: option.priceDelta,
      })),
    })),
  };
}
