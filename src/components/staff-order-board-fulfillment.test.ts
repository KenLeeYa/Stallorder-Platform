import { describe, expect, it, vi } from "vitest";
import {
  checkoutStaffDiningTable,
  queueStaffOrderPrint,
  verifyStaffOrderPickup,
  verifyStaffOrderPickupByCode,
} from "./staff-order-board-fulfillment";

const csrf = { "x-csrf-token": "token" };
const emptyCheckout = {
  paymentOptionId: null,
  discountOptionId: null,
  cashReceived: null,
  discountApprovalReason: null,
  managerEmail: null,
  managerPassword: null,
};

describe("StaffOrderBoard fulfillment commands", () => {
  it("queues an offline order locally without calling the online API", async () => {
    const fetchImpl = vi.fn();
    const queueOfflinePrintJob = vi.fn(async () => undefined);

    await expect(queueStaffOrderPrint({
      stallSlug: "night-market",
      orderId: "offline-order",
      orderSource: "OFFLINE_POS",
      fetchImpl,
      queueOfflinePrintJob,
    })).resolves.toBe("離線訂單已排入本機列印佇列；列印結果會在同步時對帳。");

    expect(queueOfflinePrintJob).toHaveBeenCalledWith("offline-order");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("queues an online print job with the existing CSRF request contract", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ state: {} }), { status: 200 }));

    await expect(queueStaffOrderPrint({
      stallSlug: "night-market",
      orderId: "online-order",
      orderSource: "QR_MENU",
      fetchImpl,
      getCsrfHeaders: () => csrf,
    })).resolves.toBe("訂單已排入列印工作佇列。");

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/stalls/night-market/print-jobs",
      {
        method: "POST",
        headers: csrf,
        body: JSON.stringify({ operation: "QUEUE", orderId: "online-order" }),
      },
    );
  });

  it("preserves print queue API and fallback errors", async () => {
    await expect(queueStaffOrderPrint({
      stallSlug: "night-market",
      orderId: "order",
      orderSource: "QR_MENU",
      fetchImpl: async () => new Response(JSON.stringify({ error: "印表機未連線。" }), { status: 409 }),
    })).rejects.toThrow("印表機未連線。");
    await expect(queueStaffOrderPrint({
      stallSlug: "night-market",
      orderId: "order",
      orderSource: "QR_MENU",
      fetchImpl: async () => new Response("{}", { status: 500 }),
    })).rejects.toThrow("目前無法排入列印工作。");
  });

  it("verifies a pickup code with the exact request and returns authoritative fields", async () => {
    const result = {
      pickupVerifiedAt: "2026-08-13T04:00:00.000Z",
      pickupVerificationMethod: "CODE" as const,
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(result), { status: 200 }));

    await expect(verifyStaffOrderPickup({
      stallSlug: "night-market",
      orderId: "order-1",
      command: { mode: "CODE", code: "123456" },
      fetchImpl,
      getCsrfHeaders: () => csrf,
    })).resolves.toEqual(result);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/stalls/night-market/orders/order-1/verify-pickup",
      {
        method: "POST",
        headers: csrf,
        body: JSON.stringify({ mode: "CODE", code: "123456" }),
      },
    );
  });

  it("preserves the manual pickup payload and mode-specific errors", async () => {
    const command = {
      mode: "MANUAL" as const,
      confirmationOrderNo: "A-101",
      reason: "DEVICE_LOST" as const,
      confirmedCustomerDetails: true as const,
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "核對資料不符。" }), { status: 409 }));

    await expect(verifyStaffOrderPickup({
      stallSlug: "night-market",
      orderId: "order-1",
      command,
      fetchImpl,
      getCsrfHeaders: () => csrf,
    })).rejects.toThrow("核對資料不符。");
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/stalls/night-market/orders/order-1/verify-pickup",
      {
        method: "POST",
        headers: csrf,
        body: JSON.stringify(command),
      },
    );

    await expect(verifyStaffOrderPickup({
      stallSlug: "night-market",
      orderId: "order-1",
      command,
      fetchImpl: async () => new Response("{}", { status: 500 }),
    })).rejects.toThrow("人工取餐核對失敗。");
    await expect(verifyStaffOrderPickup({
      stallSlug: "night-market",
      orderId: "order-1",
      command: { mode: "CODE", code: "123" },
      fetchImpl: async () => new Response("{}", { status: 500 }),
    })).rejects.toThrow("取餐碼驗證失敗。");
  });

  it("loads and verifies a ready takeout order through the quick code endpoint", async () => {
    const order = { id: "order-1", orderNo: "A025" };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ order }), { status: 200 }));

    await expect(verifyStaffOrderPickupByCode({
      stallSlug: "night-market",
      code: "738",
      fetchImpl,
      getCsrfHeaders: () => csrf,
    })).resolves.toEqual(order);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/stalls/night-market/orders/pickup-code",
      {
        method: "POST",
        headers: csrf,
        body: JSON.stringify({ code: "738" }),
      },
    );
  });

  it("submits the prepared table checkout request without changing its payment fields", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      checkoutGroupId: "group-1",
      orderIds: ["order-1", "order-2"],
    }), { status: 200 }));
    const checkout = {
      paymentOptionId: "payment-1",
      discountOptionId: "discount-1",
      cashReceived: 1_000,
      discountApprovalReason: "熟客優惠",
      managerEmail: "manager@example.com",
      managerPassword: "secret",
    };

    await expect(checkoutStaffDiningTable({
      stallSlug: "night-market",
      diningTableId: "table-1",
      orderIds: ["order-1", "order-2"],
      checkout,
      fetchImpl,
      getCsrfHeaders: () => csrf,
    })).resolves.toEqual(["order-1", "order-2"]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/stalls/night-market/table-checkout",
      {
        method: "PATCH",
        headers: csrf,
        body: JSON.stringify({
          diningTableId: "table-1",
          orderIds: ["order-1", "order-2"],
          ...checkout,
        }),
      },
    );
  });

  it("preserves table checkout API errors and the existing empty-orderIds fallback", async () => {
    await expect(checkoutStaffDiningTable({
      stallSlug: "night-market",
      diningTableId: "table-1",
      orderIds: ["order-1"],
      checkout: emptyCheckout,
      fetchImpl: async () => new Response(JSON.stringify({ error: "同桌訂單已更新。" }), { status: 409 }),
    })).rejects.toThrow("同桌訂單已更新。");
    await expect(checkoutStaffDiningTable({
      stallSlug: "night-market",
      diningTableId: "table-1",
      orderIds: ["order-1"],
      checkout: emptyCheckout,
      fetchImpl: async () => new Response("{}", { status: 500 }),
    })).rejects.toThrow("目前無法完成同桌結帳。");
    await expect(checkoutStaffDiningTable({
      stallSlug: "night-market",
      diningTableId: "table-1",
      orderIds: ["order-1"],
      checkout: emptyCheckout,
      fetchImpl: async () => new Response("{}", { status: 200 }),
    })).resolves.toEqual([]);
  });
});
