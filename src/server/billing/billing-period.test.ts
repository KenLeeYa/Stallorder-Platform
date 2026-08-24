import { describe, expect, it } from "vitest";
import { billingPeriodEndInstant, billingPeriodForInstant, hasBillingPeriodEnded } from "./billing-period";

const taipei = {
  billingTimezone: "Asia/Taipei",
  billingCycleAnchorDay: 1,
  billingPeriodType: "CALENDAR_MONTH",
};

describe("PAYG billing period", () => {
  it("uses the immutable Taipei boundary instead of a stall display timezone", () => {
    expect(billingPeriodForInstant(new Date("2026-07-31T15:59:59.000Z"), taipei).toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(billingPeriodForInstant(new Date("2026-07-31T16:00:00.000Z"), taipei).toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("converts the next local month boundary to UTC", () => {
    expect(billingPeriodEndInstant(new Date("2026-08-01T00:00:00.000Z"), taipei).toISOString()).toBe("2026-08-31T16:00:00.000Z");
    expect(hasBillingPeriodEnded(new Date("2026-08-01T00:00:00.000Z"), taipei, new Date("2026-08-31T15:59:59.000Z"))).toBe(false);
    expect(hasBillingPeriodEnded(new Date("2026-08-01T00:00:00.000Z"), taipei, new Date("2026-08-31T16:00:00.000Z"))).toBe(true);
  });
});
