import { describe, expect, it } from "vitest";
import { decideReadTarget, type ReplicationReadinessSnapshot } from "./read-router";

const now = new Date("2026-07-29T10:00:00.000Z");
const healthySnapshot: ReplicationReadinessSnapshot = {
  status: "CONNECTED",
  lagSeconds: 4,
  schemaCompatible: true,
  observedAt: new Date("2026-07-29T09:59:50.000Z"),
};

function decide(overrides: Partial<Parameters<typeof decideReadTarget>[0]> = {}) {
  return decideReadTarget({
    policy: "DR_PREFERRED_EVENTUAL",
    readAfterWrite: false,
    featureEnabled: true,
    drConfigured: true,
    drHealthStatus: "HEALTHY",
    snapshot: healthySnapshot,
    maxLagSeconds: 30,
    maxSnapshotAgeSeconds: 60,
    now,
    ...overrides,
  });
}

describe("database read router", () => {
  it("routes a healthy eventual report read to DR", () => {
    expect(decide()).toEqual({ target: "DR", reason: "DR_READY" });
  });

  it("keeps authorization and read-after-write paths on Primary", () => {
    expect(decide({ policy: "PRIMARY_ONLY" })).toEqual({
      target: "PRIMARY",
      reason: "PRIMARY_POLICY",
    });
    expect(decide({ readAfterWrite: true })).toEqual({
      target: "PRIMARY",
      reason: "READ_AFTER_WRITE",
    });
  });

  it("falls back when replication lag or evidence freshness exceeds policy", () => {
    expect(decide({
      snapshot: { ...healthySnapshot, lagSeconds: 31 },
    })).toEqual({ target: "PRIMARY", reason: "LAG_EXCEEDED" });
    expect(decide({
      snapshot: {
        ...healthySnapshot,
        observedAt: new Date("2026-07-29T09:58:00.000Z"),
      },
    })).toEqual({ target: "PRIMARY", reason: "SNAPSHOT_STALE" });
  });

  it("does not use DR when the flag, schema, or health gate is unavailable", () => {
    expect(decide({ featureEnabled: false }).reason).toBe("FEATURE_DISABLED");
    expect(decide({ drHealthStatus: "DEGRADED" }).reason).toBe("DR_UNHEALTHY");
    expect(decide({
      snapshot: { ...healthySnapshot, schemaCompatible: false },
    }).reason).toBe("SCHEMA_INCOMPATIBLE");
  });
});
