import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  completeStreamlinedOrderAfterPrint,
  getStreamlinedCheckoutPlan,
  shouldKeepQrOrderOpenAfterPayment,
} from "./streamlined-order-completion";

describe("streamlined staff checkout", () => {
  const base = {
    requestedStatus: "COMPLETED" as const,
    currentStatus: "CONFIRMED" as const,
    kdsModuleEnabled: false,
    printModuleEnabled: false,
    externalProvider: null,
    primaryPrintStatus: null,
    source: "STAFF_POS",
    paymentStatus: "UNPAID" as const,
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

  it("does not couple a prepaid QR order's final completion to receipt printing", () => {
    expect(getStreamlinedCheckoutPlan({
      ...base,
      currentStatus: "READY",
      printModuleEnabled: true,
      source: "QR_MENU",
      paymentStatus: "PAID",
    })).toEqual({
      targetStatus: "COMPLETED",
      itemStatus: "READY",
      queuePrint: false,
      completionPendingPrint: false,
    });
  });
});

describe("QR payment and print separation", () => {
  it("keeps an unpaid QR order open after staff records payment", () => {
    expect(shouldKeepQrOrderOpenAfterPayment({
      requestedStatus: "COMPLETED",
      currentStatus: "CONFIRMED",
      source: "QR_MENU",
      paymentStatus: "UNPAID",
      externalProvider: null,
      completionIntent: "COLLECT_PAYMENT",
    })).toBe(true);
  });

  it("does not reinterpret a final paid completion or external order as payment-only", () => {
    expect(shouldKeepQrOrderOpenAfterPayment({
      requestedStatus: "COMPLETED",
      currentStatus: "READY",
      source: "QR_MENU",
      paymentStatus: "PAID",
      externalProvider: null,
      completionIntent: "COLLECT_PAYMENT",
    })).toBe(false);
    expect(shouldKeepQrOrderOpenAfterPayment({
      requestedStatus: "COMPLETED",
      currentStatus: "CONFIRMED",
      source: "QR_MENU",
      paymentStatus: "UNPAID",
      externalProvider: "DELIVERY_PARTNER",
      completionIntent: "COLLECT_PAYMENT",
    })).toBe(false);
    expect(shouldKeepQrOrderOpenAfterPayment({
      requestedStatus: "COMPLETED",
      currentStatus: "CONFIRMED",
      source: "QR_MENU",
      paymentStatus: "UNPAID",
      externalProvider: null,
      completionIntent: "FINALIZE",
    })).toBe(false);
  });

  function createPrintTransaction(source: string) {
    const order = {
      id: "order-1",
      organizationId: "org-1",
      stallId: "stall-1",
      status: "READY",
      source,
      externalProvider: null,
      fulfillmentType: "TAKEOUT",
      pickupVerifiedAt: null,
      paymentStatus: "PAID",
      stall: {
        orderingSettings: { kdsModuleEnabled: false, printModuleEnabled: true },
      },
    };
    return {
      printJob: { findFirst: vi.fn().mockResolvedValue({ order }) },
      order: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      orderEvent: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as Prisma.TransactionClient;
  }

  it("never closes a QR order merely because a receipt printed", async () => {
    const transaction = createPrintTransaction("QR_MENU");

    await expect(completeStreamlinedOrderAfterPrint(transaction, "print-1")).resolves.toBe(false);
    expect(transaction.order.updateMany).not.toHaveBeenCalled();
  });

  it("preserves automatic post-print completion for staff POS orders", async () => {
    const transaction = createPrintTransaction("STAFF_POS");

    await expect(completeStreamlinedOrderAfterPrint(transaction, "print-1")).resolves.toBe(true);
    expect(transaction.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "COMPLETED" }),
    }));
  });
});
