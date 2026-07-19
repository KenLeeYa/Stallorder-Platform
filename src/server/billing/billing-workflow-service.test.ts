import { describe, expect, it } from "vitest";
import { billingPeriod, billingWorkflowErrorFromUnknown, isManualRenewalTooEarly } from "./billing-workflow-service";

describe("billingPeriod", () => {
  it("creates exact UTC monthly periods without floating money or time math", () => {
    expect(billingPeriod("MONTHLY", new Date("2026-01-31T23:55:00Z"))).toEqual({
      start: new Date("2026-01-31T00:00:00.000Z"),
      end: new Date("2026-02-28T00:00:00.000Z"),
    });
  });

  it("creates an annual period from the invoice start date", () => {
    expect(billingPeriod("ANNUAL", new Date("2026-07-19T15:00:00Z"))).toEqual({
      start: new Date("2026-07-19T00:00:00.000Z"),
      end: new Date("2027-07-19T00:00:00.000Z"),
    });
  });
});

describe("isManualRenewalTooEarly", () => {
  it("blocks only an early renewal of the same active plan version", () => {
    const subscription = { status: "ACTIVE", planVersionId: "standard-v1", billingPeriodEnd: new Date("2026-08-01T00:00:00Z") };
    const now = new Date("2026-07-19T09:00:00Z");
    expect(isManualRenewalTooEarly(subscription, "standard-v1", now)).toBe(true);
    expect(isManualRenewalTooEarly(subscription, "pro-v1", now)).toBe(false);
    expect(isManualRenewalTooEarly({ ...subscription, status: "TRIALING" }, "standard-v1", now)).toBe(false);
    expect(isManualRenewalTooEarly({ ...subscription, billingPeriodEnd: new Date("2026-07-19T00:00:00Z") }, "standard-v1", now)).toBe(false);
  });
});

describe("billingWorkflowErrorFromUnknown", () => {
  it("maps trusted database error codes to safe Traditional Chinese messages", () => {
    const error = billingWorkflowErrorFromUnknown(new Error("P0001: PAYMENT_AMOUNT_EXCEEDS_DUE"));
    expect(error?.code).toBe("PAYMENT_AMOUNT_EXCEEDS_DUE");
    expect(error?.message).toBe("付款金額不可超過帳單未付金額。");
  });

  it("does not expose unknown database errors", () => {
    expect(billingWorkflowErrorFromUnknown(new Error("database connection detail"))).toBeNull();
  });
});
