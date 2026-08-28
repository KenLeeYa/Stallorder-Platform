import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { resilienceFeatureFlag: { findMany: mocks.findMany } },
}));
vi.mock("@/server/auth/oauth/migration-readiness", () => ({ getOAuthMigrationReadiness: vi.fn() }));

describe("feature flag raw snapshot", () => {
  it("shares one database load across different device evaluations", async () => {
    mocks.findMany.mockResolvedValue([{
      code: "OFFLINE_POS_ENABLED",
      defaultEnabled: false,
      overrides: [
        {
          id: "override-a",
          scopeType: "DEVICE",
          organizationId: "organization",
          stallId: "stall",
          deviceId: "device-a",
          enabled: true,
          rolloutPercentage: null,
          expiresAt: null,
        },
        {
          id: "override-b",
          scopeType: "DEVICE",
          organizationId: "organization",
          stallId: "stall",
          deviceId: "device-b",
          enabled: false,
          rolloutPercentage: null,
          expiresAt: null,
        },
      ],
    }]);
    const { resolveResilienceFeatureFlags } = await import("./feature-flag-service");

    const [deviceA, deviceB] = await Promise.all([
      resolveResilienceFeatureFlags(["OFFLINE_POS_ENABLED"], {
        organizationId: "organization", stallId: "stall", deviceId: "device-a",
      }),
      resolveResilienceFeatureFlags(["OFFLINE_POS_ENABLED"], {
        organizationId: "organization", stallId: "stall", deviceId: "device-b",
      }),
    ]);

    expect(deviceA.OFFLINE_POS_ENABLED.enabled).toBe(true);
    expect(deviceB.OFFLINE_POS_ENABLED.enabled).toBe(false);
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
  });
});
