import { describe, expect, it } from "vitest";
import { supplyCommandSchema } from "@/server/supply-lite/supply-contract";

const id = "11111111-1111-4111-8111-111111111111";

describe("supply lite command contract", () => {
  it("normalizes an ingredient code and keeps integer micro units", () => {
    const result = supplyCommandSchema.parse({
      operation: "CREATE_INGREDIENT",
      code: "  chicken-thigh  ",
      name: "去骨雞腿",
      baseUom: "g",
      lowStockThresholdMicros: 5_000_000,
    });

    expect(result).toMatchObject({
      code: "CHICKEN-THIGH",
      baseUom: "G",
      lowStockThresholdMicros: 5_000_000,
    });
  });

  it.each([
    ["RECEIPT", -1],
    ["TRANSFER_IN", -1],
    ["WASTE", 1],
    ["TRANSFER_OUT", 1],
    ["SALE_CONSUMPTION", 1],
  ])("rejects an invalid %s quantity direction", (movementType, quantityDeltaMicros) => {
    const result = supplyCommandSchema.safeParse({
      operation: "POST_MOVEMENT",
      ingredientId: id,
      locationId: id,
      movementType,
      quantityDeltaMicros,
      unitCostMicros: 1,
      sourceType: "MANUAL_TEST",
      sourceId: "qa-001",
      idempotencyKey: "supply:qa:movement:001",
      reason: "方向驗證",
    });

    expect(result.success).toBe(false);
  });

  it("requires a stable idempotency key and a non-zero quantity", () => {
    const result = supplyCommandSchema.safeParse({
      operation: "POST_MOVEMENT",
      ingredientId: id,
      locationId: id,
      movementType: "ADJUSTMENT",
      quantityDeltaMicros: 0,
      sourceType: "MANUAL_TEST",
      sourceId: "qa-002",
      idempotencyKey: "short",
      reason: "不應通過",
    });

    expect(result.success).toBe(false);
  });

  it("bounds recipe waste to 100 percent", () => {
    const result = supplyCommandSchema.safeParse({
      operation: "UPSERT_RECIPE_COMPONENT",
      productId: id,
      ingredientId: id,
      quantityMicros: 100_000,
      wasteBasisPoints: 10_001,
    });

    expect(result.success).toBe(false);
  });
});
