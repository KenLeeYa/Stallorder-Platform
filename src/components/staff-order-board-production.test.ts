import { describe, expect, it, vi } from "vitest";
import type { OfflineOrder } from "@/offline/offline-order-contract";
import type { StaffOrderDto } from "@/lib/orders";
import {
  applyStaffOrderProductionResult,
  transitionAllStaffOrderItemStatuses,
  transitionStaffOrderItemStatus,
  transitionStaffOrderStatus,
  type StaffOrderOfflineProductionDependencies,
} from "./staff-order-board-production";

describe("StaffOrderBoard production transitions", () => {
  it("sends the existing cancellation contract and removes the terminal order", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ order: staffOrder("order-a") }));

    const result = await transitionStaffOrderStatus({
      stallSlug: "stall-slug",
      currentOrder: staffOrder("order-a"),
      orderId: "order-a",
      status: "CANCELLED",
      options: {
        confirmationOrderNo: "A-101",
        cancellationReason: "CUSTOMER_CANCELLED",
        cancellationDetail: "顧客改變心意",
      },
      fetchImpl,
      getCsrfHeaders: () => ({ "x-csrf-token": "csrf-token" }),
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/stalls/stall-slug/orders/order-a",
      {
        method: "PATCH",
        headers: { "x-csrf-token": "csrf-token" },
        body: JSON.stringify({
          status: "CANCELLED",
          confirmationOrderNo: "A-101",
          cancellationReason: "CUSTOMER_CANCELLED",
          cancellationDetail: "顧客改變心意",
        }),
      },
    );
    expect(result).toEqual({ kind: "remove", orderId: "order-a" });
  });

  it("applies only the authoritative order returned by an online status transition", async () => {
    const authoritative = staffOrder("order-a", "PUBLIC_QR", "PREPARING");
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ order: authoritative }));

    const result = await transitionStaffOrderStatus({
      stallSlug: "stall-slug",
      currentOrder: staffOrder("order-a"),
      orderId: "order-a",
      status: "PREPARING",
      fetchImpl,
      getCsrfHeaders: () => ({}),
    });

    expect(result).toEqual({ kind: "replace", order: authoritative });
    expect(applyStaffOrderProductionResult([
      staffOrder("order-a"),
      staffOrder("order-b"),
    ], result)).toEqual([authoritative, staffOrder("order-b")]);
  });

  it("keeps an order visible while streamlined checkout waits for physical printing", async () => {
    const ready = staffOrder("order-a", "STAFF_POS", "READY");
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({
      order: ready,
      completionPendingPrint: true,
    }));

    const result = await transitionStaffOrderStatus({
      stallSlug: "stall-slug",
      currentOrder: staffOrder("order-a", "STAFF_POS"),
      orderId: "order-a",
      status: "COMPLETED",
      options: {
        checkout: {
          paymentOptionId: "cash",
          discountOptionId: null,
          cashReceived: null,
          discountApprovalReason: null,
          managerEmail: null,
          managerPassword: null,
        },
      },
      fetchImpl,
      getCsrfHeaders: () => ({}),
    });

    expect(result).toEqual({
      kind: "replace",
      order: ready,
      message: "已結帳，單據列印成功後會自動完成訂單。",
    });
  });

  it("preserves server and fallback errors for order status failures", async () => {
    await expect(transitionStaffOrderStatus({
      stallSlug: "stall-slug",
      currentOrder: staffOrder("order-a"),
      orderId: "order-a",
      status: "CONFIRMED",
      fetchImpl: vi.fn<typeof fetch>(async () => jsonResponse({ error: "狀態衝突" }, 409)),
      getCsrfHeaders: () => ({}),
    })).rejects.toThrow("狀態衝突");

    await expect(transitionStaffOrderStatus({
      stallSlug: "stall-slug",
      currentOrder: staffOrder("order-a"),
      orderId: "order-a",
      status: "CONFIRMED",
      fetchImpl: vi.fn<typeof fetch>(async () => jsonResponse({}, 500)),
      getCsrfHeaders: () => ({}),
    })).rejects.toThrow("目前無法更新訂單。");
  });

  it("keeps offline completion and cancellation on the local transition chain", async () => {
    const offline = offlineDependencies();
    const completed = await transitionStaffOrderStatus({
      stallSlug: "stall-slug",
      currentOrder: staffOrder("offline-a", "OFFLINE_POS"),
      orderId: "offline-a",
      status: "COMPLETED",
      offline,
    });
    const cancelled = await transitionStaffOrderStatus({
      stallSlug: "stall-slug",
      currentOrder: staffOrder("offline-b", "OFFLINE_POS"),
      orderId: "offline-b",
      status: "CANCELLED",
      options: {
        cancellationReason: "CUSTOMER_CANCELLED",
        cancellationDetail: "顧客取消",
      },
      offline,
    });

    expect(offline.transitionOfflineOrder.mock.calls).toEqual([
      ["offline-a", "LOCAL_COMPLETED", null],
      ["offline-b", "LOCAL_CANCELLED", "CUSTOMER_CANCELLED：顧客取消"],
    ]);
    expect(completed).toEqual({
      kind: "remove",
      orderId: "offline-a",
      message: "離線訂單已在本機完成，恢復連線後會同步。",
    });
    expect(cancelled).toEqual({
      kind: "remove",
      orderId: "offline-b",
      message: "離線訂單已在本機取消，取消紀錄會在恢復連線後同步。",
    });
  });

  it("rejects unsupported offline order transitions with the existing guidance", async () => {
    await expect(transitionStaffOrderStatus({
      stallSlug: "stall-slug",
      currentOrder: staffOrder("offline-a", "OFFLINE_POS"),
      orderId: "offline-a",
      status: "PREPARING",
      offline: offlineDependencies(),
    })).rejects.toThrow("此離線訂單狀態只能依序從製作、完成餐點到完成訂單。");
  });

  it("uses the authoritative single-item API result and preserves its errors", async () => {
    const authoritative = staffOrder("order-a", "PUBLIC_QR", "PREPARING");
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ order: authoritative }));

    const result = await transitionStaffOrderItemStatus({
      stallSlug: "stall-slug",
      orderId: "order-a",
      itemId: "item-a",
      status: "READY",
      fetchImpl,
      getCsrfHeaders: () => ({ "x-csrf-token": "csrf-token" }),
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/stalls/stall-slug/orders/order-a/items/item-a",
      {
        method: "PATCH",
        headers: { "x-csrf-token": "csrf-token" },
        body: JSON.stringify({ status: "READY" }),
      },
    );
    expect(result).toEqual({ kind: "replace", order: authoritative });

    await expect(transitionStaffOrderItemStatus({
      stallSlug: "stall-slug",
      orderId: "order-a",
      itemId: "item-a",
      status: "READY",
      fetchImpl: vi.fn<typeof fetch>(async () => jsonResponse({}, 500)),
      getCsrfHeaders: () => ({}),
    })).rejects.toThrow("目前無法更新餐點狀態。");
  });

  it.each([
    ["PREPARING", "LOCAL_PREPARING", "replace", "離線製作狀態已安全儲存在此裝置。"],
    ["READY", "LOCAL_READY", "replace", "離線製作狀態已安全儲存在此裝置。"],
    ["SERVED", "LOCAL_COMPLETED", "remove", "離線訂單已在本機完成，恢復連線後會同步。"],
  ] as const)(
    "maps offline all-item %s to %s",
    async (status, offlineStatus, kind, message) => {
      const offline = offlineDependencies();
      const result = await transitionAllStaffOrderItemStatuses({
        stallSlug: "stall-slug",
        currentOrder: staffOrder("offline-a", "OFFLINE_POS"),
        orderId: "offline-a",
        status,
        offline,
      });

      expect(offline.transitionOfflineOrder).toHaveBeenCalledWith(
        "offline-a",
        offlineStatus,
      );
      expect(result.kind).toBe(kind);
      expect(result.message).toBe(message);
      expect(offline.offlineOrderToStaffOrder).toHaveBeenCalledTimes(1);
    },
  );

  it("uses the authoritative all-item API result", async () => {
    const authoritative = staffOrder("order-a", "PUBLIC_QR", "READY");
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ order: authoritative }));

    const result = await transitionAllStaffOrderItemStatuses({
      stallSlug: "stall-slug",
      currentOrder: staffOrder("order-a"),
      orderId: "order-a",
      status: "READY",
      fetchImpl,
      getCsrfHeaders: () => ({}),
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/stalls/stall-slug/orders/order-a/items",
      {
        method: "PATCH",
        headers: {},
        body: JSON.stringify({ status: "READY" }),
      },
    );
    expect(result).toEqual({ kind: "replace", order: authoritative });
  });

  it("rejects a successful transition response that omits its authoritative order", async () => {
    const missingOrder = () => vi.fn<typeof fetch>(async () => jsonResponse({}));

    await expect(transitionStaffOrderStatus({
      stallSlug: "stall-slug",
      currentOrder: staffOrder("order-a"),
      orderId: "order-a",
      status: "PREPARING",
      fetchImpl: missingOrder(),
      getCsrfHeaders: () => ({}),
    })).rejects.toThrow("目前無法更新訂單。");
    await expect(transitionStaffOrderItemStatus({
      stallSlug: "stall-slug",
      orderId: "order-a",
      itemId: "item-a",
      status: "PREPARING",
      fetchImpl: missingOrder(),
      getCsrfHeaders: () => ({}),
    })).rejects.toThrow("目前無法更新餐點狀態。");
    await expect(transitionAllStaffOrderItemStatuses({
      stallSlug: "stall-slug",
      currentOrder: staffOrder("order-a"),
      orderId: "order-a",
      status: "PREPARING",
      fetchImpl: missingOrder(),
      getCsrfHeaders: () => ({}),
    })).rejects.toThrow("目前無法批次更新餐點狀態。");
  });

  it("removes only the requested order for a terminal result", () => {
    expect(applyStaffOrderProductionResult([
      staffOrder("order-a"),
      staffOrder("order-b"),
    ], { kind: "remove", orderId: "order-a" })).toEqual([
      staffOrder("order-b"),
    ]);
  });
});

function staffOrder(
  id: string,
  source: StaffOrderDto["source"] = "PUBLIC_QR",
  status: StaffOrderDto["status"] = "CONFIRMED",
) {
  return { id, source, status } as StaffOrderDto;
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function offlineDependencies() {
  const converted = staffOrder("offline-a", "OFFLINE_POS", "PREPARING");
  return {
    transitionOfflineOrder: vi.fn(async () => ({} as OfflineOrder)),
    offlineOrderToStaffOrder: vi.fn(() => converted),
  } satisfies StaffOrderOfflineProductionDependencies;
}
