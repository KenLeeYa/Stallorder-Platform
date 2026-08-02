import { describe, expect, it } from "vitest";
import {
  bundlePriceAdjustment,
  bundleSelectionIsValid,
  toggleBundleChoice,
} from "./product-bundle-selection";

const main = {
  minSelections: 1,
  maxSelections: 1,
  options: [{ id: "chicken", priceDelta: 0 }, { id: "steak", priceDelta: 30 }],
};
const sides = {
  minSelections: 1,
  maxSelections: 2,
  options: [{ id: "fries", priceDelta: 10 }, { id: "tea", priceDelta: -5 }],
};

describe("bundle selections", () => {
  it("replaces a single-choice group without changing other groups", () => {
    expect(toggleBundleChoice(["chicken", "fries"], main, "steak"))
      .toEqual(["fries", "steak"]);
    expect(toggleBundleChoice(["chicken", "fries"], main, null))
      .toEqual(["fries"]);
  });

  it("enforces group bounds and rejects unknown choices", () => {
    expect(bundleSelectionIsValid([main, sides], ["chicken"])).toBe(false);
    expect(bundleSelectionIsValid([main, sides], ["chicken", "fries"])).toBe(true);
    expect(bundleSelectionIsValid([main, sides], ["chicken", "unknown"])).toBe(false);
  });

  it("calculates only trusted menu choice deltas", () => {
    expect(bundlePriceAdjustment([main, sides], ["steak", "tea"])).toBe(25);
  });

  it("treats an older menu without bundle groups as a single product", () => {
    expect(bundleSelectionIsValid(undefined, [])).toBe(true);
    expect(bundlePriceAdjustment(undefined, [])).toBe(0);
  });
});
