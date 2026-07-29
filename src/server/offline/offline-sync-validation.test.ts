import { describe, expect, it } from "vitest";
import type { OfflineOrderSyncRecord } from "@/offline/offline-order-contract";
import { validateOfflineEventChain } from "@/server/offline/offline-sync-validation";

function recordWithEvents(
  events: OfflineOrderSyncRecord["events"],
  finalState: OfflineOrderSyncRecord["order"]["orderStatus"],
) {
  return {
    order: { orderStatus: finalState },
    events,
  } as OfflineOrderSyncRecord;
}

const offlineOrderId = "11111111-1111-4111-8111-111111111111";

describe("offline order event-chain validation", () => {
  it("accepts a forward-only chain from a valid initial state", () => {
    expect(validateOfflineEventChain(recordWithEvents([
      {
        eventId: "22222222-2222-4222-8222-222222222222",
        offlineOrderId,
        previousState: null,
        nextState: "LOCAL_CONFIRMED",
        reason: null,
        occurredAtDevice: "2026-07-29T10:00:00.000Z",
      },
      {
        eventId: "33333333-3333-4333-8333-333333333333",
        offlineOrderId,
        previousState: "LOCAL_CONFIRMED",
        nextState: "LOCAL_PREPARING",
        reason: null,
        occurredAtDevice: "2026-07-29T10:01:00.000Z",
      },
      {
        eventId: "44444444-4444-4444-8444-444444444444",
        offlineOrderId,
        previousState: "LOCAL_PREPARING",
        nextState: "LOCAL_READY",
        reason: null,
        occurredAtDevice: "2026-07-29T10:02:00.000Z",
      },
    ], "LOCAL_READY"))).toBe(true);
  });

  it("rejects a forged completed initial event", () => {
    expect(validateOfflineEventChain(recordWithEvents([{
      eventId: "55555555-5555-4555-8555-555555555555",
      offlineOrderId,
      previousState: null,
      nextState: "LOCAL_COMPLETED",
      reason: null,
      occurredAtDevice: "2026-07-29T10:00:00.000Z",
    }], "LOCAL_COMPLETED"))).toBe(false);
  });

  it("rejects reversed timestamps and a mismatched final state", () => {
    expect(validateOfflineEventChain(recordWithEvents([
      {
        eventId: "66666666-6666-4666-8666-666666666666",
        offlineOrderId,
        previousState: null,
        nextState: "LOCAL_CONFIRMED",
        reason: null,
        occurredAtDevice: "2026-07-29T10:02:00.000Z",
      },
      {
        eventId: "77777777-7777-4777-8777-777777777777",
        offlineOrderId,
        previousState: "LOCAL_CONFIRMED",
        nextState: "LOCAL_PREPARING",
        reason: null,
        occurredAtDevice: "2026-07-29T10:01:00.000Z",
      },
    ], "LOCAL_READY"))).toBe(false);
  });
});
