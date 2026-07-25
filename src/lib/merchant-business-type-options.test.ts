import { describe, expect, it } from "vitest";
import { merchantBusinessTypeOptionCommandSchema } from "./merchant-business-type-options";

describe("merchant business type options", () => {
  it("accepts a valid platform-managed business type option", () => {
    expect(merchantBusinessTypeOptionCommandSchema.safeParse({
      code: "FOOD_TRUCK",
      legacyType: "FOOD_TRUCK",
      name: "餐車",
      description: null,
      sortOrder: 20,
      isActive: true,
    }).success).toBe(true);
  });

  it("rejects unbounded text and invalid codes", () => {
    expect(merchantBusinessTypeOptionCommandSchema.safeParse({
      code: "bad code",
      legacyType: "FOOD_TRUCK",
      name: "餐車",
      sortOrder: 20,
      isActive: true,
    }).success).toBe(false);
  });
});
