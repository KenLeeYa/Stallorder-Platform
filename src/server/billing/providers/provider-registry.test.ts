import { beforeEach, describe, expect, it, vi } from "vitest";

const { featureFlagMock } = vi.hoisted(() => ({ featureFlagMock: vi.fn() }));

vi.mock("../billing-feature-flags", () => ({ isBillingFeatureEnabled: featureFlagMock }));

import { resolveBillingProvider } from "./provider-registry";

describe("resolveBillingProvider", () => {
  beforeEach(() => featureFlagMock.mockReset());

  it("resolves the manual provider only when its server flag is enabled", async () => {
    featureFlagMock.mockResolvedValue(true);
    await expect(resolveBillingProvider("MANUAL")).resolves.toMatchObject({ code: "MANUAL" });
  });

  it("fails closed when a provider flag is disabled", async () => {
    featureFlagMock.mockResolvedValue(false);
    await expect(resolveBillingProvider("ECPAY")).rejects.toMatchObject({
      code: "BILLING_PROVIDER_NOT_CONFIGURED",
    });
  });

  it("still returns a disabled stub if a future flag is accidentally enabled", async () => {
    featureFlagMock.mockResolvedValue(true);
    const provider = await resolveBillingProvider("NEWEBPAY");
    await expect(provider.queryPayment({
      invoiceId: "invoice-1",
      providerTransactionId: "transaction-1",
    })).rejects.toMatchObject({ code: "BILLING_PROVIDER_NOT_CONFIGURED" });
  });
});
