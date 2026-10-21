import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  navigationHorizontalScrollKey,
  navigationReturnKey,
  normalizeInternalNavigationPath,
  navigationScrollKey,
  readNavigationState,
  writeNavigationState,
  removeNavigationState,
} from "@/lib/navigation-return-state";

describe("return navigation state", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("degrades when the storage getter is denied", () => {
    vi.stubGlobal("window", { get sessionStorage() { throw new DOMException("denied", "SecurityError"); } });
    expect(readNavigationState("position")).toBeNull();
    expect(() => writeNavigationState("position", "42")).not.toThrow();
    expect(() => removeNavigationState("position")).not.toThrow();
  });
  it("preserves navigation state when available and tolerates exhausted writes", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
    vi.stubGlobal("window", { sessionStorage: storage });
    writeNavigationState("position", "42");
    expect(readNavigationState("position")).toBe("42");
    removeNavigationState("position");
    expect(readNavigationState("position")).toBeNull();
    storage.setItem = () => { throw new DOMException("full", "QuotaExceededError"); };
    expect(() => writeNavigationState("position", "42")).not.toThrow();
  });
  it("accepts only same-origin application paths", () => {
    expect(normalizeInternalNavigationPath("/merchant/catalog?organizationId=org#products"))
      .toBe("/merchant/catalog?organizationId=org#products");
    expect(normalizeInternalNavigationPath("https://attacker.invalid/merchant"))
      .toBeNull();
    expect(normalizeInternalNavigationPath("//attacker.invalid/merchant"))
      .toBeNull();
    expect(normalizeInternalNavigationPath("/merchant\\admin"))
      .toBeNull();
  });

  it("uses separate scoped keys for return targets and scroll positions", () => {
    expect(navigationReturnKey("/merchant/catalog"))
      .toBe("stallorder:navigation:return:/merchant/catalog");
    expect(navigationScrollKey("/merchant/dashboard"))
      .toBe("stallorder:navigation:scroll:/merchant/dashboard");
    expect(navigationHorizontalScrollKey("staff/function row"))
      .toBe("stallorder:navigation:horizontal:staff%2Ffunction%20row");
  });

  it("does not persist MINI initialization URLs or token-bearing return paths", () => {
    for (const path of ["/mini", "/mini?liff.state=secret", "/mini/store/demo#access_token=secret"]) {
      expect(normalizeInternalNavigationPath(path)).toBeNull();
    }
    expect(normalizeInternalNavigationPath("/merchant/catalog")).toBe("/merchant/catalog");
  });

  it("mounts the navigation recorder and routes shared back links through it", () => {
    const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
    const backLink = readFileSync(new URL("../components/stall-settings-back-link.tsx", import.meta.url), "utf8");
    const navigationManager = readFileSync(new URL("../components/navigation-state-manager.tsx", import.meta.url), "utf8");

    expect(layout).toContain("<NavigationStateManager />");
    expect(backLink).toContain("<ContextualBackButton");
    expect(navigationManager).toContain("data-persist-horizontal-scroll");
    expect(navigationManager).toContain("rememberHorizontalScroll");
  });
});
