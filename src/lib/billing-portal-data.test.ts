import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  subscriptionFindUnique: vi.fn(),
  billingNotificationFindMany: vi.fn(),
  planVersionFindMany: vi.fn(),
  addOnCatalogFindMany: vi.fn(),
  billingStallUsageFindMany: vi.fn(),
  getBillingPeriodUsage: vi.fn(),
  getUsageWarnings: vi.fn(),
  getEffectiveEntitlements: vi.fn(),
  getUsableEntitlements: vi.fn(),
  resolvePlanEntitlements: vi.fn(),
  getBillingExperienceState: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    subscription: { findUnique: mocks.subscriptionFindUnique },
    billingNotification: { findMany: mocks.billingNotificationFindMany },
    planVersion: { findMany: mocks.planVersionFindMany },
    addOnCatalog: { findMany: mocks.addOnCatalogFindMany },
    billingStallUsageSummary: { findMany: mocks.billingStallUsageFindMany },
  },
}));

vi.mock("@/server/billing/entitlement-service", () => ({
  entitlementService: {
    getBillingPeriodUsage: mocks.getBillingPeriodUsage,
    getUsageWarnings: mocks.getUsageWarnings,
    getEffectiveEntitlements: mocks.getEffectiveEntitlements,
    getUsableEntitlements: mocks.getUsableEntitlements,
  },
  resolvePlanEntitlements: mocks.resolvePlanEntitlements,
}));

vi.mock("@/server/billing/billing-feature-flags", () => ({
  getBillingExperienceState: mocks.getBillingExperienceState,
}));

import { getMerchantBillingPortalData } from "./billing-portal-data";

describe("getMerchantBillingPortalData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.subscriptionFindUnique.mockResolvedValue({
      id: "subscription-id",
      billingPeriodStart: new Date("2026-08-01T00:00:00Z"),
      plan: { code: "PRO" },
      planVersion: { pricingMode: "FIXED" },
    });
    mocks.getBillingPeriodUsage.mockResolvedValue({});
    mocks.getUsageWarnings.mockResolvedValue([]);
    mocks.getEffectiveEntitlements.mockResolvedValue([]);
    mocks.billingNotificationFindMany.mockResolvedValue([]);
    mocks.addOnCatalogFindMany.mockResolvedValue([]);
    mocks.billingStallUsageFindMany.mockResolvedValue([]);
    mocks.getBillingExperienceState.mockResolvedValue({
      paygBillingEnabled: false,
      paygNewMerchantsEnabled: false,
      paygLegacyMigrationEnabled: false,
    });
  });

  it("keeps billing history readable when the subscription is not usable", async () => {
    mocks.planVersionFindMany.mockResolvedValue([]);

    await expect(getMerchantBillingPortalData("organization-id")).resolves.toBeTruthy();

    expect(mocks.getEffectiveEntitlements).toHaveBeenCalledWith("organization-id");
    expect(mocks.getUsableEntitlements).not.toHaveBeenCalled();
  });

  it("keeps explicit disabled rows visible to the compatibility resolver", async () => {
    const storedEntitlements = [
      { featureCode: "PRINTER_INTEGRATION", isEnabled: false },
      { featureCode: "CSV_EXPORT", isEnabled: true },
    ];
    const version = {
      id: "pro-v1",
      version: 1,
      pricingMode: "FIXED",
      plan: { code: "PRO" },
      entitlements: storedEntitlements,
    };
    mocks.planVersionFindMany.mockResolvedValue([version]);
    mocks.resolvePlanEntitlements.mockReturnValue(storedEntitlements);

    const result = await getMerchantBillingPortalData("organization-id");

    expect(mocks.planVersionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      include: {
        plan: true,
        entitlements: { orderBy: { featureCode: "asc" } },
      },
    }));
    expect(mocks.resolvePlanEntitlements).toHaveBeenCalledWith(version);
    expect(result?.availablePlans[0].entitlements).toEqual([
      { featureCode: "CSV_EXPORT", isEnabled: true },
    ]);
  });

  it("hides PAYG from the merchant catalog while its rollout flags are off", async () => {
    const paygVersion = {
      id: "payg-v1",
      pricingMode: "USAGE_PER_STALL_CAPPED",
      plan: { code: "PAYG" },
      entitlements: [],
    };
    mocks.planVersionFindMany.mockResolvedValue([paygVersion]);

    const result = await getMerchantBillingPortalData("organization-id");

    expect(result?.availablePlans).toEqual([]);
    expect(mocks.resolvePlanEntitlements).not.toHaveBeenCalled();
  });

  it("offers PAYG only through the enabled legacy migration request path", async () => {
    const paygVersion = {
      id: "payg-v1",
      pricingMode: "USAGE_PER_STALL_CAPPED",
      plan: { code: "PAYG" },
      entitlements: [],
    };
    mocks.planVersionFindMany.mockResolvedValue([paygVersion]);
    mocks.resolvePlanEntitlements.mockReturnValue([]);
    mocks.getBillingExperienceState.mockResolvedValue({
      paygBillingEnabled: true,
      paygNewMerchantsEnabled: false,
      paygLegacyMigrationEnabled: true,
    });

    const result = await getMerchantBillingPortalData("organization-id");

    expect(result?.availablePlans).toHaveLength(1);
    expect(result?.availablePlans[0].id).toBe("payg-v1");
  });

  it("uses the subscription period at the Asia/Taipei month boundary for PAYG summaries", async () => {
    mocks.subscriptionFindUnique.mockResolvedValue({
      id: "subscription-id",
      billingPeriodStart: new Date("2026-07-31T16:00:00Z"),
      plan: { code: "PAYG" },
      planVersion: { pricingMode: "USAGE_PER_STALL_CAPPED" },
    });
    mocks.planVersionFindMany.mockResolvedValue([]);

    await getMerchantBillingPortalData("organization-id");

    expect(mocks.billingStallUsageFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: "organization-id",
        billingPeriod: new Date("2026-08-01T00:00:00.000Z"),
      },
    }));
    expect(mocks.addOnCatalogFindMany).not.toHaveBeenCalled();
  });

  it("does not expose fixed-price legacy plans to a PAYG subscription", async () => {
    mocks.subscriptionFindUnique.mockResolvedValue({
      id: "subscription-id",
      billingPeriodStart: new Date("2026-08-01T00:00:00Z"),
      plan: { code: "PAYG" },
      planVersion: { pricingMode: "USAGE_PER_STALL_CAPPED" },
    });
    mocks.planVersionFindMany.mockResolvedValue([{
      id: "pro-v1",
      pricingMode: "FIXED",
      plan: { code: "PRO" },
      entitlements: [],
    }]);

    const result = await getMerchantBillingPortalData("organization-id");

    expect(result?.availablePlans).toEqual([]);
  });

  it("keeps legacy order packages available for fixed-price subscriptions", async () => {
    mocks.planVersionFindMany.mockResolvedValue([]);

    await getMerchantBillingPortalData("organization-id");

    expect(mocks.addOnCatalogFindMany).toHaveBeenCalledOnce();
    expect(mocks.addOnCatalogFindMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        availabilityStatus: "ENABLED",
        code: { startsWith: "ORDER_PACKAGE_PRO_" },
      },
      orderBy: { unitPrice: "asc" },
    });
    expect(mocks.billingStallUsageFindMany).not.toHaveBeenCalled();
  });
});
