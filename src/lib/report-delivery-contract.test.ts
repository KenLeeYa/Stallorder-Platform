import { describe, expect, it } from "vitest";
import { reportRetrySchema, reportReconcileSchema, reportDeliveryQuerySchema } from "./report-delivery-contract";

describe("report delivery operation commands", () => {
  it("requires the observed version and never accepts caller nonacceptance evidence", () => {
    expect(reportRetrySchema.safeParse({ expectedVersion: 3, reason: "RETRY_CONFIRMED_FAILURE" }).success).toBe(true);
    expect(reportRetrySchema.safeParse({ expectedVersion: 3, reason: "RETRY_CONFIRMED_FAILURE", provenNotAccepted: true }).success).toBe(false);
    expect(reportRetrySchema.safeParse({ reason: "RETRY_CONFIRMED_FAILURE" }).success).toBe(false);
  });
  it("reconciliation requests a trusted lookup instead of accepting a verdict or URL", () => {
    expect(reportReconcileSchema.safeParse({ expectedVersion: 2 }).success).toBe(true);
    for (const extra of [{ url: "http://127.0.0.1" }, { decision: "ACCEPTED" }, { providerMessageId: "claimed" }]) {
      expect(reportReconcileSchema.safeParse({ expectedVersion: 2, ...extra }).success).toBe(false);
    }
  });
  it("bounds reads and rejects unknown filters", () => {
    expect(reportDeliveryQuerySchema.safeParse({ limit: 50 }).success).toBe(true);
    expect(reportDeliveryQuerySchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(reportDeliveryQuerySchema.safeParse({ organizationId: "other" }).success).toBe(false);
  });
});
