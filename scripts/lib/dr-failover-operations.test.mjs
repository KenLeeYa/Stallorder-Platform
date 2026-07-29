import { describe, expect, it } from "vitest";
import {
  FailoverOperationError,
  buildRuntimeCutover,
  evaluateReadiness,
  nextPromotionEpoch,
  requireTarget,
} from "./dr-failover-operations.mjs";
import { replicatedPublicTables } from "./dr-replication-scope.mjs";

describe("DR failover operation helpers", () => {
  it("blocks a readiness result when any required evidence is missing", () => {
    expect(evaluateReadiness([
      { code: "DR_HEALTHY", ready: true },
      { code: "REPLICATION_CONNECTED", ready: false },
    ])).toEqual({
      ready: false,
      blockers: ["REPLICATION_CONNECTED"],
      checks: [
        { code: "DR_HEALTHY", ready: true, evidence: null },
        { code: "REPLICATION_CONNECTED", ready: false, evidence: null },
      ],
    });
  });

  it("increments from the highest known promotion epoch", () => {
    expect(nextPromotionEpoch(3, 7)).toBe(8);
  });

  it("rejects invalid promotion epochs", () => {
    expect(() => nextPromotionEpoch(0, 1)).toThrow(FailoverOperationError);
  });

  it("requires an explicit allowed target", () => {
    expect(requireTarget(["--target", "DR"], ["DR"])).toBe("DR");
    expect(() => requireTarget([], ["DR"])).toThrow("TARGET_MUST_BE_DR");
    expect(() => requireTarget(["--target", "PRIMARY"], ["DR"])).toThrow("TARGET_MUST_BE_DR");
  });

  it("returns only environment names and non-secret target values", () => {
    const cutover = buildRuntimeCutover("DR", 9);
    expect(cutover.nonSecretEnvironment).toEqual({
      BACKEND_ACTIVE_TARGET: "DR",
      AUTH_PROJECT_CODE: "DR",
      PROMOTION_EPOCH: "9",
    });
    expect(cutover.secretBindingsRequired).toContain(
      "DATABASE_URL <- DR runtime pooler secret",
    );
    expect(JSON.stringify(cutover)).not.toContain("postgresql://");
  });

  it("replicates the offline recovery idempotency records exactly once", () => {
    expect(replicatedPublicTables).toHaveLength(100);
    expect(new Set(replicatedPublicTables).size).toBe(replicatedPublicTables.length);
    expect(replicatedPublicTables).toEqual(expect.arrayContaining([
      "offline_order_sync_receipts",
      "offline_sync_conflicts",
      "domain_inbox",
      "domain_outbox",
    ]));
  });
});
