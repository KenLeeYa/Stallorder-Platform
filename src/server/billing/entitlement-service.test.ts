import { describe, expect, it, vi } from "vitest";
import {
  calculateUsageWarningLevels,
  canContinueOrderDuringSuspension,
  EntitlementError,
  EntitlementService,
  entitlementErrorFromUnknown,
  evaluateCountLimit,
  evaluateSubscriptionUsability,
  orderPackageSize,
} from "@/server/billing/entitlement-service";

describe("EntitlementService policy helpers", () => {
  it.each(["ACTIVE", "PAST_DUE", "GRACE_PERIOD"])(
    "allows usable paid status %s",
    (status) => {
      expect(evaluateSubscriptionUsability({ status, trialEndsAt: null })).toBeNull();
    },
  );

  it("allows an unexpired trial", () => {
    expect(evaluateSubscriptionUsability({
      status: "TRIALING",
      trialEndsAt: new Date(Date.now() + 60_000),
    })).toBeNull();
  });

  it("rejects an expired trial", () => {
    expect(evaluateSubscriptionUsability({
      status: "TRIALING",
      trialEndsAt: new Date(Date.now() - 1),
    })).toBe("TRIAL_EXPIRED");
  });

  it("distinguishes suspended and inactive subscriptions", () => {
    expect(evaluateSubscriptionUsability({ status: "SUSPENDED", trialEndsAt: null }))
      .toBe("SUBSCRIPTION_SUSPENDED");
    expect(evaluateSubscriptionUsability({ status: "CANCELLED", trialEndsAt: null }))
      .toBe("SUBSCRIPTION_NOT_ACTIVE");
  });

  it("enforces finite count limits and preserves unlimited limits", () => {
    expect(evaluateCountLimit(6, 5)).toBe("PLAN_LIMIT_REACHED");
    expect(evaluateCountLimit(5, 5)).toBeNull();
    expect(evaluateCountLimit(100_000, null)).toBeNull();
  });

  it("returns every crossed paid usage threshold", () => {
    expect(calculateUsageWarningLevels(79, 100)).toEqual([]);
    expect(calculateUsageWarningLevels(80, 100)).toEqual([80]);
    expect(calculateUsageWarningLevels(110, 100)).toEqual([80, 90, 100, 110]);
  });

  it("resolves only known order package sizes", () => {
    expect(orderPackageSize("ORDER_PACKAGE_LITE_100")).toBe(100);
    expect(orderPackageSize("ORDER_PACKAGE_STANDARD_500")).toBe(500);
    expect(orderPackageSize("ORDER_PACKAGE_PRO_1000")).toBe(1_000);
    expect(orderPackageSize("CUSTOM_SERVICE")).toBe(0);
  });

  it("allows only confirmed in-flight orders to continue while suspended", () => {
    expect(canContinueOrderDuringSuspension("CONFIRMED", "PREPARING")).toBe(true);
    expect(canContinueOrderDuringSuspension("PREPARING", "READY")).toBe(true);
    expect(canContinueOrderDuringSuspension("READY", "COMPLETED")).toBe(true);
    expect(canContinueOrderDuringSuspension("WAITING_CONFIRMATION", "CONFIRMED")).toBe(false);
    expect(canContinueOrderDuringSuspension("COMPLETED", "READY")).toBe(false);
  });

  it("maps database trigger errors to safe typed errors", () => {
    const mapped = entitlementErrorFromUnknown(
      new Error("database error P0001: ADDITIONAL_STALL_APPROVAL_REQUIRED"),
    );
    expect(mapped).toBeInstanceOf(EntitlementError);
    expect(mapped?.code).toBe("ADDITIONAL_STALL_APPROVAL_REQUIRED");
    expect(mapped?.message).not.toContain("P0001");
  });

  it("reuses one subscription context query when checking an enabled feature", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      status: "ACTIVE",
      trialEndsAt: null,
      planVersion: {
        version: 1,
        plan: { code: "STANDARD" },
        entitlements: [{
          featureCode: "KDS",
          isEnabled: true,
          limitValue: 3,
          configurationJson: null,
        }],
      },
      items: [],
    });
    const addOnFindMany = vi.fn().mockResolvedValue([]);
    const service = new EntitlementService({
      subscription: { findUnique },
      addOnCatalog: { findMany: addOnFindMany, findFirst: vi.fn() },
    } as never);

    await expect(service.assertFeatureEnabled("organization-id", "KDS"))
      .resolves.toMatchObject({ featureCode: "KDS", isEnabled: true });
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        planVersion: {
          select: expect.objectContaining({
            entitlements: expect.objectContaining({
              where: { featureCode: "KDS" },
              take: 1,
            }),
          }),
        },
      }),
    }));
    expect(addOnFindMany).not.toHaveBeenCalled();
  });

  it("queries add-ons only when the selected plan feature is unavailable", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      status: "ACTIVE",
      trialEndsAt: null,
      planVersion: { version: 1, plan: { code: "STANDARD" }, entitlements: [] },
      items: [{ code: "KDS_ADD_ON" }],
    });
    const addOnFindFirst = vi.fn().mockResolvedValue({ featureCode: "KDS" });
    const service = new EntitlementService({
      subscription: { findUnique },
      addOnCatalog: { findFirst: addOnFindFirst },
    } as never);

    await expect(service.assertFeatureEnabled("organization-id", "KDS"))
      .resolves.toMatchObject({ featureCode: "KDS", source: "ADD_ON" });
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(addOnFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        code: { in: ["KDS_ADD_ON"] },
        featureCode: "KDS",
      }),
    }));
  });

  it("loads usable plan and add-on entitlements from one subscription context", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      status: "ACTIVE",
      trialEndsAt: null,
      planVersion: {
        version: 1,
        plan: { code: "STANDARD" },
        entitlements: [{
          featureCode: "WAIT_TIME_QUOTE",
          isEnabled: true,
          limitValue: null,
          configurationJson: null,
        }],
      },
      items: [{ itemType: "ADD_ON", code: "CAPACITY_ADD_ON" }],
    });
    const addOnFindMany = vi.fn().mockResolvedValue([{
      featureCode: "CAPACITY_CONTROL",
    }]);
    const service = new EntitlementService({
      subscription: { findUnique },
      addOnCatalog: { findMany: addOnFindMany },
    } as never);

    await expect(service.getUsableEntitlements("organization-id")).resolves.toEqual([
      expect.objectContaining({ featureCode: "CAPACITY_CONTROL", source: "ADD_ON" }),
      expect.objectContaining({ featureCode: "WAIT_TIME_QUOTE", source: "PLAN" }),
    ]);
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(addOnFindMany).toHaveBeenCalledTimes(1);
  });

  it.each(["PRO", "ENTERPRISE"])(
    "grants legacy %s v1 printer compatibility through authorization and effective entitlements",
    async (planCode) => {
      const subscriptionContext = {
        status: "ACTIVE",
        trialEndsAt: null,
        planVersion: {
          version: 1,
          plan: { code: planCode },
          entitlements: [],
        },
        items: [],
      };
      const findUnique = vi.fn().mockResolvedValue(subscriptionContext);
      const service = new EntitlementService({
        subscription: { findUnique },
        addOnCatalog: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
      } as never);

      await expect(service.assertFeatureEnabled("organization-id", "PRINTER_INTEGRATION"))
        .resolves.toMatchObject({
          featureCode: "PRINTER_INTEGRATION",
          configuration: { merchantModuleOptIn: true },
          source: "PLAN",
        });
      await expect(service.getUsableEntitlements("organization-id"))
        .resolves.toContainEqual(expect.objectContaining({
          featureCode: "PRINTER_INTEGRATION",
          isEnabled: true,
          source: "PLAN",
        }));
    },
  );

  it.each(["TRIAL", "LITE", "STANDARD"])(
    "does not grant printer compatibility to %s v1",
    async (planCode) => {
      const service = new EntitlementService({
        subscription: {
          findUnique: vi.fn().mockResolvedValue({
            status: "ACTIVE",
            trialEndsAt: null,
            planVersion: { version: 1, plan: { code: planCode }, entitlements: [] },
            items: [],
          }),
        },
        addOnCatalog: { findFirst: vi.fn() },
      } as never);

      await expect(service.assertFeatureEnabled("organization-id", "PRINTER_INTEGRATION"))
        .rejects.toMatchObject({ code: "FEATURE_NOT_INCLUDED" });
    },
  );

  it.each(["PRO", "ENTERPRISE"])(
    "does not extend the legacy printer compatibility rule to future %s versions",
    async (planCode) => {
    const service = new EntitlementService({
      subscription: {
        findUnique: vi.fn().mockResolvedValue({
          status: "ACTIVE",
          trialEndsAt: null,
          planVersion: { version: 2, plan: { code: planCode }, entitlements: [] },
          items: [],
        }),
      },
      addOnCatalog: { findFirst: vi.fn() },
    } as never);

    await expect(service.assertFeatureEnabled("organization-id", "PRINTER_INTEGRATION"))
      .rejects.toMatchObject({ code: "FEATURE_NOT_INCLUDED" });
    },
  );

  it("preserves an explicit disabled printer entitlement on legacy Pro", async () => {
    const service = new EntitlementService({
      subscription: {
        findUnique: vi.fn().mockResolvedValue({
          status: "ACTIVE",
          trialEndsAt: null,
          planVersion: {
            version: 1,
            plan: { code: "PRO" },
            entitlements: [{
              featureCode: "PRINTER_INTEGRATION",
              isEnabled: false,
              limitValue: null,
              configurationJson: null,
            }],
          },
          items: [],
        }),
      },
      addOnCatalog: { findFirst: vi.fn() },
    } as never);

    await expect(service.assertFeatureEnabled("organization-id", "PRINTER_INTEGRATION"))
      .rejects.toMatchObject({ code: "FEATURE_NOT_INCLUDED" });
  });

  it("allows an active add-on to override an explicit disabled plan entitlement", async () => {
    const subscriptionContext = {
      status: "ACTIVE",
      trialEndsAt: null,
      planVersion: {
        version: 1,
        plan: { code: "STANDARD" },
        entitlements: [{
          featureCode: "KDS",
          isEnabled: false,
          limitValue: null,
          configurationJson: null,
        }],
      },
      items: [{ itemType: "ADD_ON", code: "KDS_ADD_ON" }],
    };
    const service = new EntitlementService({
      subscription: { findUnique: vi.fn().mockResolvedValue(subscriptionContext) },
      addOnCatalog: {
        findFirst: vi.fn().mockResolvedValue({ featureCode: "KDS" }),
        findMany: vi.fn().mockResolvedValue([{ featureCode: "KDS" }]),
      },
    } as never);

    await expect(service.assertFeatureEnabled("organization-id", "KDS"))
      .resolves.toMatchObject({ featureCode: "KDS", isEnabled: true, source: "ADD_ON" });
    await expect(service.getEffectiveEntitlements("organization-id"))
      .resolves.toContainEqual(expect.objectContaining({
        featureCode: "KDS",
        isEnabled: true,
        source: "ADD_ON",
      }));
  });

  it("does not bypass subscription usability for legacy Pro printer access", async () => {
    const service = new EntitlementService({
      subscription: {
        findUnique: vi.fn().mockResolvedValue({
          status: "SUSPENDED",
          trialEndsAt: null,
          planVersion: { version: 1, plan: { code: "PRO" }, entitlements: [] },
          items: [],
        }),
      },
      addOnCatalog: { findFirst: vi.fn() },
    } as never);

    await expect(service.assertFeatureEnabled("organization-id", "PRINTER_INTEGRATION"))
      .rejects.toMatchObject({ code: "SUBSCRIPTION_SUSPENDED" });
  });

  it("allows uncapped per-stall PAYG to add stalls without an additional-stall approval", async () => {
    const database = limitDatabase({
      pricingMode: "USAGE_PER_STALL_CAPPED",
      usageScope: "STALL",
      maxStalls: null,
      activeStalls: 4,
    });
    const service = new EntitlementService(database as never);

    await expect(service.assertLimitAvailable("organization-id", "STALLS", 1))
      .resolves.toMatchObject({ usage: { activeStalls: 4 } });
  });

  it.each([
    { pricingMode: "FIXED", usageScope: null, maxStalls: null },
    { pricingMode: "USAGE_PER_STALL_CAPPED", usageScope: "STALL", maxStalls: 10 },
  ])(
    "keeps additional-stall approvals for non-uncapped legacy contracts %#",
    async ({ pricingMode, usageScope, maxStalls }) => {
      const service = new EntitlementService(limitDatabase({
        pricingMode,
        usageScope,
        maxStalls,
        activeStalls: 1,
      }) as never);

      await expect(service.assertLimitAvailable("organization-id", "STALLS", 1))
        .rejects.toMatchObject({ code: "ADDITIONAL_STALL_APPROVAL_REQUIRED" });
    },
  );

  it("does not let open beta bypass a missing subscription", async () => {
    const service = new EntitlementService({
      billingFeatureFlag: {
        findMany: vi.fn().mockResolvedValue([{
          code: "OPEN_BETA_FREE_ACCESS_ENABLED",
          isEnabled: true,
        }]),
      },
      subscription: { findUnique: vi.fn().mockResolvedValue(null) },
    } as never);

    await expect(service.assertFeatureEnabled("organization-id", "KDS"))
      .rejects.toMatchObject({ code: "SUBSCRIPTION_NOT_ACTIVE" });
    await expect(service.assertSubscriptionUsable("organization-id"))
      .rejects.toMatchObject({ code: "SUBSCRIPTION_NOT_ACTIVE" });
  });

  it("preserves plan feature configuration while open beta removes feature limits", async () => {
    const service = new EntitlementService({
      billingFeatureFlag: {
        findMany: vi.fn().mockResolvedValue([{
          code: "OPEN_BETA_FREE_ACCESS_ENABLED",
          isEnabled: true,
        }]),
      },
      subscription: {
        findUnique: vi.fn().mockResolvedValue({
          status: "ACTIVE",
          trialEndsAt: null,
          planVersion: {
            version: 1,
            plan: { code: "PAYG" },
            entitlements: [{
              featureCode: "STALL_SCHEDULE",
              isEnabled: true,
              limitValue: 365,
              configurationJson: { eventSchedule: true, recurringCopy: true },
            }],
          },
          items: [],
        }),
      },
    } as never);

    await expect(service.assertFeatureEnabled("organization-id", "STALL_SCHEDULE"))
      .resolves.toEqual({
        featureCode: "STALL_SCHEDULE",
        isEnabled: true,
        limitValue: null,
        configuration: { eventSchedule: true, recurringCopy: true },
        source: "OPEN_BETA",
      });
  });

  it("does not enforce plan limits during open beta for an eligible merchant", async () => {
    const subscriptionContext = {
      status: "ACTIVE",
      trialEndsAt: null,
      planVersion: { version: 1, plan: { code: "LITE" }, entitlements: [] },
      items: [],
      additionalApprovals: [],
    };
    const service = new EntitlementService({
      billingFeatureFlag: {
        findMany: vi.fn().mockResolvedValue([{
          code: "OPEN_BETA_FREE_ACCESS_ENABLED",
          isEnabled: true,
        }]),
      },
      subscription: { findUnique: vi.fn().mockResolvedValue(subscriptionContext) },
    } as never);

    await expect(service.assertLimitAvailable("organization-id", "ORDERS", 1))
      .resolves.toMatchObject({ context: subscriptionContext, usage: null, openBeta: true });
  });

  it.each(["SUSPENDED", "CANCELLED"])(
    "keeps %s subscriptions blocked during open beta",
    async (status) => {
      const service = new EntitlementService({
        billingFeatureFlag: {
          findMany: vi.fn().mockResolvedValue([{
            code: "OPEN_BETA_FREE_ACCESS_ENABLED",
            isEnabled: true,
          }]),
        },
        subscription: {
          findUnique: vi.fn().mockResolvedValue({
            status,
            trialEndsAt: null,
            planVersion: { version: 1, plan: { code: "LITE" }, entitlements: [] },
            items: [],
            additionalApprovals: [],
          }),
        },
      } as never);

      await expect(service.assertSubscriptionUsable("organization-id"))
        .rejects.toMatchObject({
          code: status === "SUSPENDED" ? "SUBSCRIPTION_SUSPENDED" : "SUBSCRIPTION_NOT_ACTIVE",
        });
    },
  );
});

function limitDatabase(input: {
  pricingMode: string;
  usageScope: string | null;
  maxStalls: number | null;
  activeStalls: number;
}) {
  const subscriptionContext = {
    status: "ACTIVE",
    trialEndsAt: null,
    billingPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
    planVersion: {
      version: 1,
      plan: { code: "PAYG" },
      entitlements: [],
      includedStalls: 1,
      maxStalls: input.maxStalls,
      maxStaff: null,
      maxProducts: null,
      maxQrCodes: null,
      includedOrders: null,
      emergencyHardCapEnabled: false,
      emergencyHardCapOrders: null,
      pricingMode: input.pricingMode,
      usageScope: input.usageScope,
    },
    items: [],
    additionalApprovals: [],
  };

  return {
    subscription: { findUnique: vi.fn().mockResolvedValue(subscriptionContext) },
    usageEvent: { aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 0 } }) },
    stall: { count: vi.fn().mockResolvedValue(input.activeStalls) },
    product: { count: vi.fn().mockResolvedValue(0) },
    qrCode: { count: vi.fn().mockResolvedValue(0) },
    $queryRaw: vi.fn().mockResolvedValue([{ count: 0 }]),
  };
}
