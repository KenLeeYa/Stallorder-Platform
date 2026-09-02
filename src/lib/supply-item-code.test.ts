import { describe, expect, it } from "vitest";
import { suggestSupplyItemCode } from "./supply-item-code";

describe("supply item code suggestion", () => {
  it.each([
    ["去骨雞腿", "INGREDIENT", "ING-QU-GU-JI-TUI"],
    ["12oz 紙杯", "PACKAGING", "PKG-12OZ-ZHI-BEI"],
    ["清潔手套", "CONSUMABLE", "CON-QING-JIE-SHOU-TAO"],
    ["內用餐盤", "REUSABLE_EQUIPMENT", "EQP-NEI-YONG-CAN-PAN"],
  ] as const)("uses the name and item type for %s", (name, itemType, expected) => {
    expect(suggestSupplyItemCode({ name, itemType, existingCodes: [] })).toBe(expected);
  });

  it("adds a stable suffix when the suggested code already exists", () => {
    expect(suggestSupplyItemCode({
      name: "去骨雞腿",
      itemType: "INGREDIENT",
      existingCodes: ["ING-QU-GU-JI-TUI", "ING-QU-GU-JI-TUI-2"],
    })).toBe("ING-QU-GU-JI-TUI-3");
  });

  it("ignores the current code while editing and always returns a valid bounded code", () => {
    expect(suggestSupplyItemCode({
      name: "去骨雞腿",
      itemType: "INGREDIENT",
      existingCodes: ["ING-QU-GU-JI-TUI"],
      currentCode: "ING-QU-GU-JI-TUI",
    })).toBe("ING-QU-GU-JI-TUI");

    const fallback = suggestSupplyItemCode({
      name: "🎉".repeat(80),
      itemType: "PACKAGING",
      existingCodes: [],
    });
    expect(fallback).toMatch(/^[A-Z0-9][A-Z0-9_-]{1,39}$/);
    expect(fallback.length).toBeLessThanOrEqual(40);
  });
});
