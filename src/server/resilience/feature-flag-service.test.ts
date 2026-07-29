import { describe, expect, it } from "vitest";
import {
  evaluateResilienceFeatureFlag,
  resilienceFlagOverrideCommandSchema,
} from "@/server/resilience/feature-flag-service";

const now = new Date("2026-07-29T08:00:00.000Z");

function override(
  values: Partial<Parameters<typeof evaluateResilienceFeatureFlag>[0]["overrides"][number]> = {},
) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    scopeType: "GLOBAL",
    organizationId: null,
    stallId: null,
    deviceId: null,
    enabled: true,
    rolloutPercentage: null,
    expiresAt: null,
    ...values,
  };
}

describe("resilience feature flag evaluation", () => {
  it("uses the catalog default when no active override exists", () => {
    expect(evaluateResilienceFeatureFlag({
      code: "OFFLINE_POS_ENABLED",
      defaultEnabled: false,
      overrides: [],
    }, {}, now)).toMatchObject({
      enabled: false,
      source: "DEFAULT",
      overrideId: null,
    });
  });

  it("ignores expired overrides", () => {
    expect(evaluateResilienceFeatureFlag({
      code: "OFFLINE_POS_ENABLED",
      defaultEnabled: false,
      overrides: [override({ expiresAt: new Date("2026-07-29T07:59:59.000Z") })],
    }, {}, now)).toMatchObject({
      enabled: false,
      source: "DEFAULT",
    });
  });

  it("applies device, stall, organization and global precedence", () => {
    const context = {
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      stallId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      deviceId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    };
    const result = evaluateResilienceFeatureFlag({
      code: "OFFLINE_POS_ENABLED",
      defaultEnabled: false,
      overrides: [
        override({ id: "10000000-0000-4000-8000-000000000001", enabled: false }),
        override({
          id: "10000000-0000-4000-8000-000000000002",
          scopeType: "ORGANIZATION",
          organizationId: context.organizationId,
          enabled: false,
        }),
        override({
          id: "10000000-0000-4000-8000-000000000003",
          scopeType: "STALL",
          organizationId: context.organizationId,
          stallId: context.stallId,
          enabled: false,
        }),
        override({
          id: "10000000-0000-4000-8000-000000000004",
          scopeType: "DEVICE",
          organizationId: context.organizationId,
          stallId: context.stallId,
          deviceId: context.deviceId,
          enabled: true,
        }),
      ],
    }, context, now);

    expect(result).toMatchObject({
      enabled: true,
      source: "DEVICE",
      overrideId: "10000000-0000-4000-8000-000000000004",
    });
  });

  it("supports deterministic percentage rollout without changing the default outside the bucket", () => {
    const flag = {
      code: "ROLLING_RELEASE_ENABLED",
      defaultEnabled: false,
      overrides: [override({
        scopeType: "PERCENTAGE",
        rolloutPercentage: 100,
      })],
    };
    expect(evaluateResilienceFeatureFlag(flag, { rolloutKey: "organization-a" }, now))
      .toMatchObject({ enabled: true, source: "PERCENTAGE" });

    flag.overrides[0].rolloutPercentage = 0;
    expect(evaluateResilienceFeatureFlag(flag, { rolloutKey: "organization-a" }, now))
      .toMatchObject({ enabled: false, source: "DEFAULT" });
  });
});

describe("resilience feature flag command validation", () => {
  it("accepts a complete Stall override", () => {
    expect(resilienceFlagOverrideCommandSchema.safeParse({
      scopeType: "STALL",
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      stallId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      enabled: true,
      reason: "指定攤位試行",
    }).success).toBe(true);
  });

  it("rejects target fields that do not match the selected scope", () => {
    expect(resilienceFlagOverrideCommandSchema.safeParse({
      scopeType: "GLOBAL",
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      enabled: true,
      reason: "錯誤的全域設定",
    }).success).toBe(false);

    expect(resilienceFlagOverrideCommandSchema.safeParse({
      scopeType: "PERCENTAGE",
      enabled: true,
      reason: "缺少發布比例",
    }).success).toBe(false);
  });
});
