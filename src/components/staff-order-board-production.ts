import type { CancellationReason, OrderItemStatus } from "@prisma/client";
import type { StaffOrderCheckoutRequest } from "@/components/staff-order-board-checkout";
import { csrfHeaders } from "@/lib/csrf-client";
import { staffStatusOptions, type StaffOrderDto } from "@/lib/orders";
import type { OfflineOrder, OfflineOrderState } from "@/offline/offline-order-contract";

export type StaffOrderProductionStatus = (typeof staffStatusOptions)[number]["value"];

export type StaffOrderStatusTransitionOptions = {
  confirmationOrderNo?: string;
  cancellationReason?: CancellationReason;
  cancellationDetail?: string | null;
  managerAuthorizationCode?: string | null;
  checkout?: StaffOrderCheckoutRequest;
};

export type StaffOrderProductionResult =
  | { kind: "replace"; order: StaffOrderDto; message?: string }
  | { kind: "remove"; orderId: string; message?: string };

export type StaffOrderOfflineProductionDependencies = {
  transitionOfflineOrder: (
    orderId: string,
    nextState: OfflineOrderState,
    reason?: string | null,
  ) => Promise<OfflineOrder>;
  offlineOrderToStaffOrder: (order: OfflineOrder) => StaffOrderDto;
};

type ProductionTransport = {
  fetchImpl?: typeof fetch;
  getCsrfHeaders?: () => HeadersInit;
};

export async function transitionStaffOrderStatus(input: ProductionTransport & {
  stallSlug: string;
  currentOrder: StaffOrderDto | undefined;
  orderId: string;
  status: StaffOrderProductionStatus;
  options?: StaffOrderStatusTransitionOptions;
  offline?: StaffOrderOfflineProductionDependencies;
}): Promise<StaffOrderProductionResult> {
  const options = input.options ?? {};
  if (input.currentOrder?.source === "OFFLINE_POS") {
    const nextState = input.status === "COMPLETED"
      ? "LOCAL_COMPLETED"
      : input.status === "CANCELLED" ? "LOCAL_CANCELLED" : null;
    if (!nextState) {
      throw new Error("此離線訂單狀態只能依序從製作、完成餐點到完成訂單。");
    }
    const offline = input.offline ?? await loadOfflineDependencies();
    await offline.transitionOfflineOrder(
      input.orderId,
      nextState,
      input.status === "CANCELLED"
        ? [options.cancellationReason, options.cancellationDetail]
          .filter(Boolean)
          .join("：") || "現場取消"
        : null,
    );
    return {
      kind: "remove",
      orderId: input.orderId,
      message: input.status === "COMPLETED"
        ? "離線訂單已在本機完成，恢復連線後會同步。"
        : "離線訂單已在本機取消，取消紀錄會在恢復連線後同步。",
    };
  }

  const response = await (input.fetchImpl ?? fetch)(
    `/api/stalls/${input.stallSlug}/orders/${input.orderId}`,
    {
      method: "PATCH",
      headers: (input.getCsrfHeaders ?? csrfHeaders)(),
      body: JSON.stringify({
        status: input.status,
        ...(input.status === "COMPLETED" && input.currentOrder?.source === "QR_MENU"
          ? {
              completionIntent: input.currentOrder.paymentStatus === "UNPAID"
                ? "COLLECT_PAYMENT"
                : "FINALIZE",
            }
          : {}),
        ...(input.status === "CANCELLED" ? {
          confirmationOrderNo: options.confirmationOrderNo,
          cancellationReason: options.cancellationReason,
          cancellationDetail: options.cancellationDetail,
          managerAuthorizationCode: options.managerAuthorizationCode,
        } : {}),
        ...(input.status === "COMPLETED" ? options.checkout : {}),
      }),
    },
  );
  const payload = await response.json() as {
    order?: StaffOrderDto;
    error?: string;
    completionPendingPrint?: boolean;
    completionPendingFulfillment?: boolean;
  };
  if (!response.ok) throw new Error(payload.error ?? "目前無法更新訂單。");
  if (input.status === "COMPLETED" && payload.completionPendingFulfillment) {
    if (!payload.order) throw new Error("目前無法更新訂單。");
    return {
      kind: "replace",
      order: payload.order,
      message: "已收款，訂單會保留至餐點交付完成。",
    };
  }
  if (input.status === "COMPLETED" && payload.completionPendingPrint) {
    if (!payload.order) throw new Error("目前無法更新訂單。");
    return {
      kind: "replace",
      order: payload.order,
      message: "已結帳，單據列印成功後會自動完成訂單。",
    };
  }
  if (input.status === "COMPLETED" || input.status === "CANCELLED") {
    return { kind: "remove", orderId: input.orderId };
  }
  if (!payload.order) throw new Error("目前無法更新訂單。");
  return { kind: "replace", order: payload.order };
}

export async function transitionStaffOrderItemStatus(input: ProductionTransport & {
  stallSlug: string;
  orderId: string;
  itemId: string;
  status: Exclude<OrderItemStatus, "PENDING">;
}): Promise<StaffOrderProductionResult> {
  const response = await (input.fetchImpl ?? fetch)(
    `/api/stalls/${input.stallSlug}/orders/${input.orderId}/items/${input.itemId}`,
    {
      method: "PATCH",
      headers: (input.getCsrfHeaders ?? csrfHeaders)(),
      body: JSON.stringify({ status: input.status }),
    },
  );
  const payload = await response.json() as { order?: StaffOrderDto; error?: string };
  if (!response.ok || !payload.order) {
    throw new Error(payload.error ?? "目前無法更新餐點狀態。");
  }
  return { kind: "replace", order: payload.order };
}

export async function transitionAllStaffOrderItemStatuses(input: ProductionTransport & {
  stallSlug: string;
  currentOrder: StaffOrderDto | undefined;
  orderId: string;
  status: "PREPARING" | "READY" | "SERVED";
  offline?: StaffOrderOfflineProductionDependencies;
}): Promise<StaffOrderProductionResult> {
  if (input.currentOrder?.source === "OFFLINE_POS") {
    const nextState = input.status === "PREPARING"
      ? "LOCAL_PREPARING"
      : input.status === "READY" ? "LOCAL_READY" : "LOCAL_COMPLETED";
    const offline = input.offline ?? await loadOfflineDependencies();
    const updated = await offline.transitionOfflineOrder(input.orderId, nextState);
    const order = offline.offlineOrderToStaffOrder(updated);
    return nextState === "LOCAL_COMPLETED"
      ? {
          kind: "remove",
          orderId: input.orderId,
          message: "離線訂單已在本機完成，恢復連線後會同步。",
        }
      : {
          kind: "replace",
          order,
          message: "離線製作狀態已安全儲存在此裝置。",
        };
  }

  const response = await (input.fetchImpl ?? fetch)(
    `/api/stalls/${input.stallSlug}/orders/${input.orderId}/items`,
    {
      method: "PATCH",
      headers: (input.getCsrfHeaders ?? csrfHeaders)(),
      body: JSON.stringify({ status: input.status }),
    },
  );
  const payload = await response.json() as { order?: StaffOrderDto; error?: string };
  if (!response.ok || !payload.order) {
    throw new Error(payload.error ?? "目前無法批次更新餐點狀態。");
  }
  return { kind: "replace", order: payload.order };
}

export function applyStaffOrderProductionResult(
  orders: StaffOrderDto[],
  result: StaffOrderProductionResult,
) {
  if (result.kind === "remove") {
    return orders.filter((order) => order.id !== result.orderId);
  }
  return orders.map((order) => order.id === result.order.id ? result.order : order);
}

async function loadOfflineDependencies(): Promise<StaffOrderOfflineProductionDependencies> {
  const [{ transitionOfflineOrder }, { offlineOrderToStaffOrder }] = await Promise.all([
    import("@/offline/offline-operations"),
    import("@/offline/offline-staff-order"),
  ]);
  return { transitionOfflineOrder, offlineOrderToStaffOrder };
}
