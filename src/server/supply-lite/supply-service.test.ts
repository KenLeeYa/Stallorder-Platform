import { describe, expect, it } from "vitest";
import { calculateAverageUnitCost } from "@/server/supply-lite/supply-service";

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
