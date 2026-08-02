import { describe, expect, it } from "vitest";
import { parseMerchantBackSource, resolveMerchantBackNavigation } from "@/lib/merchant-back-navigation";

describe("merchant back navigation", () => {
  it("returns to the KDS board only for the allowlisted kitchen source", () => {
    expect(resolveMerchantBackNavigation({
      source: "kitchen",
      allowedSources: ["kitchen"],
      stallId: "stall-id",
      stallSlug: "阿明 雞排",
    })).toEqual({ href: "/kitchen?stall=%E9%98%BF%E6%98%8E%20%E9%9B%9E%E6%8E%92", label: "返回生產看板" });
  });

  it("falls back to stall settings for missing or disallowed sources", () => {
    expect(resolveMerchantBackNavigation({ stallId: "stall-id" }))
      .toEqual({ href: "/merchant/stalls/stall-id", label: "返回攤位設定" });
    expect(resolveMerchantBackNavigation({
      source: "localization",
      allowedSources: ["kitchen"],
      stallId: "stall-id",
      organizationId: "organization-id",
    })).toEqual({ href: "/merchant/stalls/stall-id", label: "返回攤位設定" });
  });

  it("rejects arbitrary return targets", () => {
    expect(parseMerchantBackSource("https://attacker.invalid")).toBeUndefined();
    expect(resolveMerchantBackNavigation({ source: "../../admin", stallId: "stall-id" }))
      .toEqual({ href: "/merchant/stalls/stall-id", label: "返回攤位設定" });
  });

  it("preserves validated catalog and localization origins", () => {
    expect(resolveMerchantBackNavigation({ source: "stall-products", stallSlug: "aming-chicken" }))
      .toEqual({ href: "/merchant/aming-chicken", label: "返回商品供應" });
    expect(resolveMerchantBackNavigation({
      source: "localization",
      organizationId: "organization-id",
      stallId: "stall-id",
    })).toEqual({
      href: "/merchant/localization?organizationId=organization-id&stallId=stall-id",
      label: "返回翻譯完整度",
    });
  });

  it("returns an authorized settings link to the staff board", () => {
    expect(resolveMerchantBackNavigation({
      source: "staff",
      allowedSources: ["staff"],
      stallId: "stall-id",
      stallSlug: "aming-chicken",
    })).toEqual({ href: "/staff/aming-chicken", label: "返回店員訂單" });
  });
});
