import { describe, expect, it } from "vitest";
import {
  competitiveModuleCatalog,
  competitiveModuleCodes,
  moduleFlagCode,
} from "@/server/competitive-enhancements/module-catalog";

describe("competitive enhancement module catalog", () => {
  it("defines every Master Prompt module exactly once", () => {
    expect(competitiveModuleCodes).toEqual([
      "CORE_OPS",
      "GROWTH",
      "OMNI",
      "HQ",
      "SUPPLY_LITE",
      "EVENT_GROWTH",
      "PUBLIC_API",
      "ADVANCED_ANALYTICS",
    ]);
    expect(new Set(competitiveModuleCatalog.map((entry) => entry.code)).size)
      .toBe(competitiveModuleCodes.length);
  });

  it("uses a dedicated server feature flag for every module", () => {
    for (const code of competitiveModuleCodes) {
      expect(moduleFlagCode(code)).toBe(`MODULE_${code}_ENABLED`);
    }
    expect(competitiveModuleCatalog.every((entry) => entry.setupPath.startsWith("/merchant/"))).toBe(true);
  });

  it("keeps external and advanced modules disabled by default", () => {
    for (const entry of competitiveModuleCatalog) {
      if (entry.code === "CORE_OPS") continue;
      expect(entry.defaultEnabled).toBe(false);
    }
  });
});
