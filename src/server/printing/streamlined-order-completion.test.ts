import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  completeStreamlinedOrderAfterPickup,
  getStreamlinedCheckoutPlan,
} from "./streamlined-order-completion";

describe("streamlined staff checkout", () => {
  const base = {
    requestedStatus: "COMPLETED" as const,
    currentStatus: "CONFIRMED" as const,
    kdsModuleEnabled: false,
    printModuleEnabled: false,
    externalProvider: null,
    primaryPrintStatus: null,
  };

  it("completes immediately when both KDS and printing are disabled", () => {
    expect(getStreamlinedCheckoutPlan(base)).toEqual({
      targetStatus: "COMPLETED",
      itemStatus: "READY",
      queuePrint: false,
      completionPendingPrint: false,
    });
  });

  it("takes payment but waits at READY until the primary print succeeds", () => {
    expect(getStreamlinedCheckoutPlan({ ...base, printModuleEnabled: true })).toEqual({
      targetStatus: "READY",
      itemStatus: "READY",
      queuePrint: true,
      completionPendingPrint: true,
    });
  });

  it("completes a retry immediately when its primary receipt has already printed", () => {
    expect(getStreamlinedCheckoutPlan({
      ...base,
      currentStatus: "READY",
      printModuleEnabled: true,
      primaryPrintStatus: "SUCCEEDED",
    })).toEqual({
      targetStatus: "COMPLETED",
      itemStatus: "READY",
      queuePrint: false,
      completionPendingPrint: false,
    });
  });

  it("does not bypass KDS or external delivery workflows", () => {
    expect(getStreamlinedCheckoutPlan({ ...base, kdsModuleEnabled: true })).toBeNull();
    expect(getStreamlinedCheckoutPlan({ ...base, externalProvider: "UBER_EATS" })).toBeNull();
  });
});

describe("streamlined QR takeout completion", () => {
  function createTransaction(overrides: Record<string, unknown> = {}) {
    const order = {
      id: "order-1",
      organizationId: "org-1",
      stallId: "stall-1",
      status: "READY",
      source: "QR_MENU",
      externalProvider: null,
      fulfillmentType: "TAKEOUT",
      pickupVerifiedAt: new Date("2026-08-21T12:00:00.000Z"),
      paymentStatus: "PAID",
      printJobs: [{ id: "print-1" }],
      stall: {
        orderingSettings: { kdsModuleEnabled: false, printModuleEnabled: true },
      },
      ...overrides,
    };
    return {
      order: {
        findFirst: vi.fn().mockResolvedValue(order),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      orderEvent: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as Prisma.TransactionClient;
  }

  it("completes a printed KDS-off QR takeout order after pickup verification", async () => {
    const transaction = createTransaction();

    await expect(completeStreamlinedOrderAfterPickup(transaction, "order-1")).resolves.toBe(true);
    expect(transaction.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "COMPLETED" }),
    }));
    expect(transaction.orderEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ eventType: "ORDER_AUTO_COMPLETED_AFTER_PICKUP" }),
    });
  });

  it("keeps the order ready until its primary receipt succeeds", async () => {
    const transaction = createTransaction({ printJobs: [] });

    await expect(completeStreamlinedOrderAfterPickup(transaction, "order-1")).resolves.toBe(false);
    expect(transaction.order.updateMany).not.toHaveBeenCalled();
  });

  it("completes after pickup without a receipt when printing has been disabled", async () => {
    const transaction = createTransaction({
      printJobs: [],
      stall: {
        orderingSettings: { kdsModuleEnabled: false, printModuleEnabled: false },
      },
    });

    await expect(completeStreamlinedOrderAfterPickup(transaction, "order-1")).resolves.toBe(true);
    expect(transaction.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "COMPLETED" }),
    }));
  });
});
