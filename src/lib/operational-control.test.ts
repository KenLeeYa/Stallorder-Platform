import { describe, expect, it } from "vitest";
import { batchOrderingSchema, orderingStateForBatchAction } from "./operational-control";

describe("orderingStateForBatchAction", () => {
  it("maps pause and resume to safe stall states", () => {
    expect(orderingStateForBatchAction("PAUSE")).toEqual({ businessStatus: "PAUSED", orderingEnabled: false });
    expect(orderingStateForBatchAction("RESUME")).toEqual({ businessStatus: "OPEN", orderingEnabled: true });
  });
});

describe("batchOrderingSchema", () => {
  it("requires explicit confirmation and unique stall ids", () => {
    const stallId = "22222222-2222-4222-8222-222222222222";
    expect(batchOrderingSchema.safeParse({ action: "PAUSE", stallIds: [stallId], confirmation: "CONFIRM_BATCH_ACTION" }).success).toBe(true);
    expect(batchOrderingSchema.safeParse({ action: "PAUSE", stallIds: [stallId, stallId], confirmation: "CONFIRM_BATCH_ACTION" }).success).toBe(false);
    expect(batchOrderingSchema.safeParse({ action: "PAUSE", stallIds: [stallId] }).success).toBe(false);
  });
});
