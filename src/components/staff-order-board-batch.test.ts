import { describe, expect, it, vi } from "vitest";
import type { StaffOrderDto } from "@/lib/orders";
import {
  undoStaffOrderItemBatch,
  updateStaffOrderItemBatch,
} from "./staff-order-board-batch";

const csrf = { "x-csrf-token": "token" };

describe("StaffOrderBoard batch commands", () => {
  it("updates selected items and returns authoritative orders plus undo metadata", async () => {
    const orders = [{ id: "order-1" }] as StaffOrderDto[];
    const payload = {
      orders,
      actionId: "action-1",
      undoExpiresAt: "2026-08-13T08:05:00.000Z",
      itemCount: 2,
    };
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(payload));

    await expect(updateStaffOrderItemBatch({
      stallSlug: "night-market",
      itemIds: ["item-1", "item-2"],
      status: "READY",
      fetchImpl,
      getCsrfHeaders: () => csrf,
    })).resolves.toEqual({
      orders,
      undoBatch: {
        actionId: payload.actionId,
        undoExpiresAt: payload.undoExpiresAt,
        itemCount: payload.itemCount,
      },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/stalls/night-market/order-items/batch",
      {
        method: "PATCH",
        headers: csrf,
        body: JSON.stringify({
          operation: "UPDATE",
          itemIds: ["item-1", "item-2"],
          status: "READY",
        }),
      },
    );
  });

  it("undoes a batch with the existing request contract", async () => {
    const orders = [{ id: "order-1" }] as StaffOrderDto[];
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ orders }));

    await expect(undoStaffOrderItemBatch({
      stallSlug: "night-market",
      actionId: "action-1",
      fetchImpl,
      getCsrfHeaders: () => csrf,
    })).resolves.toEqual(orders);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/stalls/night-market/order-items/batch",
      {
        method: "PATCH",
        headers: csrf,
        body: JSON.stringify({ operation: "UNDO", actionId: "action-1" }),
      },
    );
  });

  it("preserves update and undo API errors and fallbacks", async () => {
    await expect(updateStaffOrderItemBatch({
      stallSlug: "night-market",
      itemIds: ["item-1"],
      status: "PREPARING",
      fetchImpl: vi.fn<typeof fetch>(async () => jsonResponse({ error: "餐點狀態已更新。" }, 409)),
    })).rejects.toThrow("餐點狀態已更新。");
    await expect(updateStaffOrderItemBatch({
      stallSlug: "night-market",
      itemIds: ["item-1"],
      status: "PREPARING",
      fetchImpl: vi.fn<typeof fetch>(async () => jsonResponse({}, 500)),
    })).rejects.toThrow("目前無法批次更新餐點狀態。");
    await expect(undoStaffOrderItemBatch({
      stallSlug: "night-market",
      actionId: "action-1",
      fetchImpl: vi.fn<typeof fetch>(async () => jsonResponse({ error: "復原期限已過。" }, 409)),
    })).rejects.toThrow("復原期限已過。");
    await expect(undoStaffOrderItemBatch({
      stallSlug: "night-market",
      actionId: "action-1",
      fetchImpl: vi.fn<typeof fetch>(async () => jsonResponse({}, 500)),
    })).rejects.toThrow("目前無法復原餐點狀態。");
  });
});

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
