import { describe, expect, it } from "vitest";
import {
  initializeAccessibilityModeScript,
  isAccessibilityMode,
  oppositeAccessibilityMode,
  shouldUseMobileSeniorMenu,
} from "@/lib/accessibility-mode";

describe("accessibility mode", () => {
  it("recognizes only the supported interface modes", () => {
    expect(isAccessibilityMode("standard")).toBe(true);
    expect(isAccessibilityMode("senior")).toBe(true);
    expect(isAccessibilityMode("large")).toBe(false);
  });

  it("switches between the standard and senior modes", () => {
    expect(oppositeAccessibilityMode("standard")).toBe("senior");
    expect(oppositeAccessibilityMode("senior")).toBe("standard");
  });

  it("uses the senior action menu only on mobile screens", () => {
    expect(shouldUseMobileSeniorMenu("senior", true)).toBe(true);
    expect(shouldUseMobileSeniorMenu("senior", false)).toBe(false);
    expect(shouldUseMobileSeniorMenu("standard", true)).toBe(false);
  });

  it("initializes the document before hydration to avoid a layout flash", () => {
    expect(initializeAccessibilityModeScript).toContain("stallorder.accessibility.preference");
    expect(initializeAccessibilityModeScript).toContain("dataset.interfaceMode");
  });
});
