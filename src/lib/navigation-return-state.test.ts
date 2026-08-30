import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  navigationHorizontalScrollKey,
  navigationReturnKey,
  normalizeInternalNavigationPath,
  navigationScrollKey,
} from "@/lib/navigation-return-state";

describe("return navigation state", () => {
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
