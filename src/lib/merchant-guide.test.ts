import { describe, expect, it } from "vitest";
import {
  findCurrentMerchantGuideItem,
  getVisibleMerchantGuideItems,
  merchantGuideItems,
  type MerchantGuideScope,
} from "@/lib/merchant-guide";

function scope(overrides: Partial<MerchantGuideScope> = {}): MerchantGuideScope {
  return {
    organizationId: "organization-1",
    operatingMode: "SINGLE_STALL",
    merchantSetupState: "COMPLETED",
    roles: ["ORGANIZATION_OWNER"],
    stall: {
      id: "stall-1",
      name: "測試攤位",
      slug: "test-stall",
      kdsEnabled: false,
      roles: ["ORGANIZATION_OWNER"],
    },
    features: {
      billing: false,
      growth: false,
      payments: false,
      supply: false,
    },
    ...overrides,
  };
}

function ids(result: ReturnType<typeof getVisibleMerchantGuideItems>) {
  return result.map((item) => item.id);
}

describe("merchant system guide visibility", () => {
  it("keeps catalog ids unique", () => {
    expect(new Set(merchantGuideItems.map((item) => item.id)).size).toBe(merchantGuideItems.length);
  });

  it("shows only enabled modules and hides setup after onboarding", () => {
    const result = ids(getVisibleMerchantGuideItems(scope()));

    expect(result).toContain("stall-operations");
    expect(result).toContain("staff-pos");
    expect(result).toContain("kds-module");
    expect(result).not.toContain("merchant-setup");
    expect(result).not.toContain("supply");
    expect(result).not.toContain("growth");
    expect(result).not.toContain("payment-integrations");
    expect(result).not.toContain("billing");
    expect(result).not.toContain("kitchen-board");
    expect(result).not.toContain("kds-stations");
  });

  it("adds optional modules only when their platform switch is enabled", () => {
    const result = ids(getVisibleMerchantGuideItems(scope({
      features: { billing: true, growth: true, payments: true, supply: true },
    })));

    expect(result).toEqual(expect.arrayContaining([
      "supply",
      "growth",
      "payment-integrations",
      "billing",
    ]));
  });

  it("removes stall-only help until a stall is selected", () => {
    const result = getVisibleMerchantGuideItems(scope({ stall: null }));

    expect(result.every((item) => !item.requiresStall)).toBe(true);
  });

  it("limits staff to functions granted by their stall role", () => {
    const result = ids(getVisibleMerchantGuideItems(scope({
      roles: [],
      stall: {
        id: "stall-1",
        name: "測試攤位",
        slug: "test-stall",
        kdsEnabled: false,
        roles: ["STAFF"],
      },
    })));

    expect(result).toContain("staff-pos");
    expect(result).toContain("cash-shift");
    expect(result).not.toContain("manage-stalls");
    expect(result).not.toContain("shared-catalog");
    expect(result).not.toContain("team");
  });

  it("shows setup and multi-stall topics only in their matching state", () => {
    const result = ids(getVisibleMerchantGuideItems(scope({
      operatingMode: "MULTI_STALL",
      merchantSetupState: "IN_PROGRESS",
    })));

    expect(result).toContain("merchant-setup");
    expect(result).toContain("report-stalls");
    expect(result).toContain("market-events");
  });

  it("matches the most specific help topic for the current page", () => {
    const guideScope = scope();
    const visible = getVisibleMerchantGuideItems(guideScope);

    expect(findCurrentMerchantGuideItem(
      visible,
      guideScope,
      "/merchant/stalls/stall-1/settings/special-hours",
    )?.id).toBe("special-hours");
    expect(findCurrentMerchantGuideItem(
      visible,
      guideScope,
      "/merchant/test-stall",
    )?.id).toBe("stall-operations");
  });
});
