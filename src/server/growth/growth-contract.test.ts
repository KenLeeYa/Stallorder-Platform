import { describe, expect, it } from "vitest";
import {
  assertGrowthCampaignTransition,
  classifyRfmSegment,
  growthCommandSchema,
} from "@/server/growth/growth-contract";

describe("growth campaign contract", () => {
  it("accepts a bounded percentage campaign", () => {
    const parsed = growthCommandSchema.parse({
      operation: "CREATE_COUPON_CAMPAIGN",
      name: "開幕九折",
      discountType: "PERCENT",
      discountValue: 10,
      budgetAmount: 20_000,
      perCustomerLimit: 1,
      minimumOrderAmount: 200,
      startsAt: "2026-09-01T00:00:00.000+08:00",
      endsAt: "2026-09-30T23:59:59.000+08:00",
      channels: ["QR", "LINE_ORDERING", "QR"],
    });

    expect(parsed.operation).toBe("CREATE_COUPON_CAMPAIGN");
    if (parsed.operation !== "CREATE_COUPON_CAMPAIGN") throw new Error("unexpected command");
    expect(parsed.channels).toEqual(["QR", "LINE_ORDERING"]);
  });

  it("rejects a percentage over 100 and a reversed campaign window", () => {
    const parsed = growthCommandSchema.safeParse({
      operation: "CREATE_COUPON_CAMPAIGN",
      name: "錯誤活動",
      discountType: "PERCENT",
      discountValue: 101,
      budgetAmount: 1_000,
      perCustomerLimit: 1,
      minimumOrderAmount: 0,
      startsAt: "2026-09-30T00:00:00.000+08:00",
      endsAt: "2026-09-01T00:00:00.000+08:00",
      channels: ["QR"],
    });

    expect(parsed.success).toBe(false);
  });

  it.each([
    [{ recencyDays: 3, frequency: 12, monetaryAmount: 5000 }, "CHAMPION"],
    [{ recencyDays: 15, frequency: 6, monetaryAmount: 2000 }, "LOYAL"],
    [{ recencyDays: 80, frequency: 8, monetaryAmount: 4000 }, "AT_RISK"],
    [{ recencyDays: 120, frequency: 1, monetaryAmount: 100 }, "HIBERNATING"],
  ])("classifies RFM without exposing customer identity", (input, expected) => {
    expect(classifyRfmSegment(input)).toBe(expected);
  });

  it("prevents a finished campaign from being reactivated", () => {
    expect(() => assertGrowthCampaignTransition("ENDED", "ACTIVE"))
      .toThrow("GROWTH_CAMPAIGN_TRANSITION_INVALID");
  });
});
