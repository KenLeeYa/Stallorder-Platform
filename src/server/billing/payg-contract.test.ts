import { describe, expect, it } from "vitest";
import { assertPaygContractIntegrity, calculatePaygContractHash, type PaygContractVersion } from "./payg-contract";

function fixture(): PaygContractVersion {
  return {
    id: "version-id", planId: "plan-id", version: 2, displayName: "PAYG", billingInterval: "MONTHLY",
    basePrice: 0, annualPrice: null, currency: "TWD", trialDays: null, includedStalls: 0, maxStalls: null,
    additionalStallPrice: null, maxStaff: null, maxProducts: null, maxQrCodes: null, includedOrders: null,
    reportRetentionDays: null, overagePolicy: "ALLOW", pricingMode: "USAGE_PER_STALL_CAPPED", usageUnitPrice: 1,
    usageMetric: "NET_BILLABLE_COMPLETED_ORDER", usageScope: "STALL", monthlyCapAmount: 1499, minimumCharge: 0,
    billingTimezone: "Asia/Taipei", billingCycleAnchorDay: 1, billingPeriodType: "CALENDAR_MONTH", invoiceCloseDelayHours: 24,
    taxTreatment: "INCLUSIVE", taxRateBps: 500, taxJurisdiction: "TW", taxRoundingMode: "HALF_UP",
    taxRoundingScope: "INVOICE", capTaxBasis: "TAX_INCLUSIVE_TOTAL", taxDocumentRequired: true,
    sealedAt: null, sealedByProfileId: null, contractHash: null,
    entitlements: [
      { featureCode: "QR_ORDERING", isEnabled: true, limitValue: null, configurationJson: { b: 2, a: 1 } },
      { featureCode: "REPORTING", isEnabled: true, limitValue: 10, configurationJson: null },
    ],
  };
}

describe("PAYG contract hash", () => {
  it("is deterministic across entitlement and JSON key order", () => {
    const first = fixture();
    const second = fixture();
    second.entitlements = [...second.entitlements].reverse().map((entry) => entry.featureCode === "QR_ORDERING" ? { ...entry, configurationJson: { a: 1, b: 2 } } : entry);
    expect(calculatePaygContractHash(first)).toBe(calculatePaygContractHash(second));
  });

  it("fails closed after a sealed contract is altered", () => {
    const version = fixture();
    version.contractHash = calculatePaygContractHash(version);
    version.sealedAt = new Date("2026-08-24T00:00:00.000Z");
    version.sealedByProfileId = "11111111-1111-4111-8111-111111111111";
    expect(() => assertPaygContractIntegrity(version)).not.toThrow();
    version.monthlyCapAmount = 1500;
    expect(() => assertPaygContractIntegrity(version)).toThrow("PAYG_CONTRACT_HASH_MISMATCH");
  });
});
