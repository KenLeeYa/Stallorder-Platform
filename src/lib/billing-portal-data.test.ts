import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  subscriptionFindUnique: vi.fn(),
  billingNotificationFindMany: vi.fn(),
  planVersionFindMany: vi.fn(),
  addOnCatalogFindMany: vi.fn(),
  getBillingPeriodUsage: vi.fn(),
  getUsageWarnings: vi.fn(),
  getEffectiveEntitlements: vi.fn(),
  getUsableEntitlements: vi.fn(),
  resolvePlanEntitlements: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    subscription: { findUnique: mocks.subscriptionFindUnique },
    billingNotification: { findMany: mocks.billingNotificationFindMany },
    planVersion: { findMany: mocks.planVersionFindMany },
    addOnCatalog: { findMany: mocks.addOnCatalogFindMany },
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

import { getMerchantBillingPortalData } from "./billing-portal-data";

describe("getMerchantBillingPortalData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.subscriptionFindUnique.mockResolvedValue({
      id: "subscription-id",
      billingPeriodStart: new Date("2026-08-01T00:00:00Z"),
    });
    mocks.getBillingPeriodUsage.mockResolvedValue({});
    mocks.getUsageWarnings.mockResolvedValue([]);
    mocks.getEffectiveEntitlements.mockResolvedValue([]);
    mocks.billingNotificationFindMany.mockResolvedValue([]);
    mocks.addOnCatalogFindMany.mockResolvedValue([]);
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
});
