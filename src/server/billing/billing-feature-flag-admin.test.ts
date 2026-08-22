import { describe, expect, it } from "vitest";
import { assertBillingFeatureFlagTransition } from "@/server/billing/billing-feature-flag-admin";

const state = {
  openBetaFreeAccess: true,
  merchantBillingVisible: false,
  paygBillingEnabled: false,
  paygNewMerchantsEnabled: false,
  paygLegacyMigrationEnabled: false,
  paygRefundCreditsEnabled: false,
  paygAutomaticInvoiceCloseEnabled: false,
};

describe("billing feature flag transitions", () => {
  it("allows the free beta and merchant visibility switches independently", () => {
    expect(() => assertBillingFeatureFlagTransition(
      "OPEN_BETA_FREE_ACCESS_ENABLED",
      false,
      state,
    )).not.toThrow();
    expect(() => assertBillingFeatureFlagTransition(
      "MERCHANT_BILLING_VISIBLE",
      true,
      state,
    )).not.toThrow();
  });

  it("does not allow automatic invoice close while free beta is active", () => {
    expect(() => assertBillingFeatureFlagTransition(
      "PAYG_AUTOMATIC_INVOICE_CLOSE_ENABLED",
      true,
      { ...state, paygBillingEnabled: true, paygRefundCreditsEnabled: true },
    )).toThrow("PAYG_OPEN_BETA_STILL_ENABLED");
  });

  it("requires PAYG billing before new-merchant or legacy migration rollout", () => {
    expect(() => assertBillingFeatureFlagTransition(
      "PAYG_NEW_MERCHANTS_ENABLED",
      true,
      state,
    )).toThrow("PAYG_BILLING_NOT_ENABLED");
    expect(() => assertBillingFeatureFlagTransition(
      "PAYG_LEGACY_MIGRATION_ENABLED",
      true,
      state,
    )).toThrow("PAYG_BILLING_NOT_ENABLED");
  });
});
