import { describe, expect, it } from "vitest";
import { allocateFefoLotConsumption, calculateAverageUnitCost } from "@/server/supply-lite/supply-service";

describe("Supply Lite moving average cost", () => {
  it("weights an incoming receipt against positive stock", () => {
    expect(calculateAverageUnitCost({
      previousQuantity: BigInt(10),
      previousAverageUnitCost: BigInt(20),
      incomingQuantity: BigInt(30),
      incomingUnitCost: BigInt(40),
    })).toBe(BigInt(35));
  });

  it("does not rewrite average cost for a waste movement", () => {
    expect(calculateAverageUnitCost({
      previousQuantity: BigInt(10),
      previousAverageUnitCost: BigInt(20),
      incomingQuantity: BigInt(-2),
      incomingUnitCost: BigInt(99),
    })).toBe(BigInt(20));
  });
});

describe("Supply Lite FEFO lot allocation", () => {
  it("consumes the earliest expiry first and leaves undated lots last", () => {
    const allocation = allocateFefoLotConsumption([
      { id: "undated", remainingQuantityMicros: BigInt(8), expiresOn: null, receivedAt: new Date("2026-08-01T00:00:00Z") },
      { id: "later", remainingQuantityMicros: BigInt(5), expiresOn: new Date("2026-09-10T00:00:00Z"), receivedAt: new Date("2026-08-01T00:00:00Z") },
      { id: "earlier", remainingQuantityMicros: BigInt(4), expiresOn: new Date("2026-09-01T00:00:00Z"), receivedAt: new Date("2026-08-20T00:00:00Z") },
    ], BigInt(12));

    expect(allocation.allocations).toEqual([
      { id: "earlier", consumed: BigInt(4), remaining: BigInt(0) },
      { id: "later", consumed: BigInt(5), remaining: BigInt(0) },
      { id: "undated", consumed: BigInt(3), remaining: BigInt(5) },
    ]);
    expect(allocation.unallocated).toBe(BigInt(0));
  });

  it("reports quantity that cannot be matched to a recorded lot", () => {
    const allocation = allocateFefoLotConsumption([
      { id: "only", remainingQuantityMicros: BigInt(3), expiresOn: null, receivedAt: new Date("2026-08-01T00:00:00Z") },
    ], BigInt(5));

    expect(allocation.allocations).toEqual([
      { id: "only", consumed: BigInt(3), remaining: BigInt(0) },
    ]);
    expect(allocation.unallocated).toBe(BigInt(2));
  });
});
