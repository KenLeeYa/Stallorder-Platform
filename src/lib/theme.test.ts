import { describe, expect, it } from "vitest";
import {
  initializeThemeScript,
  isInterfaceTheme,
  oppositeInterfaceTheme,
  THEME_STORAGE_KEY,
} from "@/lib/theme";

describe("interface theme", () => {
  it("accepts only the supported persisted values", () => {
    expect(isInterfaceTheme("light")).toBe(true);
    expect(isInterfaceTheme("dark")).toBe(true);
    expect(isInterfaceTheme("system")).toBe(false);
    expect(isInterfaceTheme(null)).toBe(false);
  });

  it("switches between light and dark", () => {
    expect(oppositeInterfaceTheme("light")).toBe("dark");
    expect(oppositeInterfaceTheme("dark")).toBe("light");
  });

  it("initializes from the same storage key before hydration", () => {
    expect(initializeThemeScript).toContain(THEME_STORAGE_KEY);
    expect(initializeThemeScript).toContain('dataset.theme = theme');
    expect(initializeThemeScript).toContain('style.colorScheme = theme');
  });
});
