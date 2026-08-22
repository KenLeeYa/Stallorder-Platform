import { describe, expect, it, vi } from "vitest";
import {
  billingFeatureFlagDefaults,
  getBillingExperienceState,
  isBillingFeatureEnabled,
  resolveBillingFeatureFlags,
} from "@/server/billing/billing-feature-flags";

describe("billing feature flags", () => {
  it("fails safely to free beta with merchant billing hidden when rows are not migrated yet", async () => {
    const database = {
      billingFeatureFlag: { findMany: vi.fn().mockResolvedValue([]) },
    };

    await expect(getBillingExperienceState(database)).resolves.toEqual({
      openBetaFreeAccess: true,
      merchantBillingVisible: false,
      paygBillingEnabled: false,
      paygNewMerchantsEnabled: false,
      paygLegacyMigrationEnabled: false,
      paygRefundCreditsEnabled: false,
      paygAutomaticInvoiceCloseEnabled: false,
    });
  });

  it("uses stored values without changing unrelated defaults", async () => {
    const database = {
      billingFeatureFlag: {
        findMany: vi.fn().mockResolvedValue([
          { code: "OPEN_BETA_FREE_ACCESS_ENABLED", isEnabled: false },
          { code: "MERCHANT_BILLING_VISIBLE", isEnabled: true },
        ]),
      },
    };

    const flags = await resolveBillingFeatureFlags([
      "OPEN_BETA_FREE_ACCESS_ENABLED",
      "MERCHANT_BILLING_VISIBLE",
      "PAYG_BILLING_ENABLED",
    ], database);
    expect(flags).toEqual({
      OPEN_BETA_FREE_ACCESS_ENABLED: false,
      MERCHANT_BILLING_VISIBLE: true,
      PAYG_BILLING_ENABLED: false,
    });
  });

  it("keeps the manual provider enabled by its legacy default", async () => {
    const database = {
      billingFeatureFlag: { findMany: vi.fn().mockResolvedValue([]) },
    };
    expect(billingFeatureFlagDefaults.MANUAL_BILLING_ENABLED).toBe(true);
    await expect(isBillingFeatureEnabled("MANUAL_BILLING_ENABLED", database)).resolves.toBe(true);
  });
});
