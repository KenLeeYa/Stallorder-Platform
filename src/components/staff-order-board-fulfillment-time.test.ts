import { describe, expect, it, vi } from "vitest";
import type { StaffOrderDto } from "@/lib/orders";
import { updateStaffOrderFulfillmentTime } from "./staff-order-board-fulfillment-time";

const csrf = { "x-csrf-token": "token" };

describe("StaffOrderBoard fulfillment-time command", () => {
  it("submits a proposal with the existing API contract and returns the authoritative order", async () => {
    const order = { id: "order-1", fulfillmentTimeVersion: 3 } as StaffOrderDto;
    const command = {
      operation: "PROPOSE" as const,
      version: 2,
      proposedFulfillmentAt: "2026-08-13T08:30:00.000Z",
      reason: "目前訂單較多",
    };
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ order }));

    await expect(updateStaffOrderFulfillmentTime({
      stallSlug: "night-market",
      orderId: "order-1",
      command,
      fetchImpl,
      getCsrfHeaders: () => csrf,
    })).resolves.toEqual(order);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/stalls/night-market/orders/order-1/fulfillment-time",
      {
        method: "PATCH",
        headers: csrf,
        body: JSON.stringify(command),
      },
    );
  });

  it("preserves confirmation payloads and API errors", async () => {
    const command = { operation: "CONFIRM_REQUESTED" as const, version: 4 };
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ error: "時間版本已更新。" }, 409));

    await expect(updateStaffOrderFulfillmentTime({
      stallSlug: "night-market",
      orderId: "order-1",
      command,
      fetchImpl,
      getCsrfHeaders: () => csrf,
    })).rejects.toThrow("時間版本已更新。");
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/stalls/night-market/orders/order-1/fulfillment-time",
      {
        method: "PATCH",
        headers: csrf,
        body: JSON.stringify(command),
      },
    );
  });

  it("submits the customer-present override without inventing a fulfillment time", async () => {
    const order = { id: "order-1", status: "READY", fulfillmentTimeVersion: 5 } as StaffOrderDto;
    const command = { operation: "CUSTOMER_PRESENT" as const, version: 4 };
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ order }));

    await expect(updateStaffOrderFulfillmentTime({
      stallSlug: "night-market",
      orderId: "order-1",
      command,
      fetchImpl,
      getCsrfHeaders: () => csrf,
    })).resolves.toEqual(order);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/stalls/night-market/orders/order-1/fulfillment-time",
      expect.objectContaining({ body: JSON.stringify(command) }),
    );
  });

  it("rejects an unsuccessful or incomplete response with the existing fallback", async () => {
    for (const response of [jsonResponse({}, 500), jsonResponse({}, 200)]) {
      await expect(updateStaffOrderFulfillmentTime({
        stallSlug: "night-market",
        orderId: "order-1",
        command: { operation: "CONFIRM_REQUESTED", version: 1 },
        fetchImpl: vi.fn<typeof fetch>(async () => response),
      })).rejects.toThrow("目前無法更新取餐或送達時間。");
    }
  });
});

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
