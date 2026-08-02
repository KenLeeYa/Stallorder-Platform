import { describe, expect, it } from "vitest";
import {
  createProductionApprovalReceipt,
  stableJson,
  validateProductionApprovalReceipt,
} from "./production-approval.mjs";

const NOW = new Date("2026-08-02T00:00:00.000Z");
const COMMIT_SHA = "a".repeat(40);
const TREE_SHA = "b".repeat(40);

function validReceipt(overrides = {}) {
  return createProductionApprovalReceipt({
    repository: "KenLeeYa/Stallorder-Platform",
    planRunId: "30723323487",
    commitSha: COMMIT_SHA,
    treeSha: TREE_SHA,
    stagingTreeSha: TREE_SHA,
    operation: "production-migrations",
    parameters: { includeAllMigrations: false },
    requestedBy: "KenLeeYa",
    createdAt: NOW,
    ...overrides,
  });
}

function validMetadata(overrides = {}) {
  return {
    id: 30723323487,
    path: ".github/workflows/production-readiness.yml",
    head_branch: "main",
    head_sha: COMMIT_SHA,
    status: "completed",
    conclusion: "success",
    event: "push",
    actor: { login: "KenLeeYa" },
    created_at: NOW.toISOString(),
    updated_at: new Date(NOW.getTime() + 60_000).toISOString(),
    ...overrides,
  };
}

function validate(receipt = validReceipt(), overrides = {}) {
  return validateProductionApprovalReceipt({
    receipt,
    expected: {
      repository: "KenLeeYa/Stallorder-Platform",
      planRunId: "30723323487",
      commitSha: COMMIT_SHA,
      treeSha: TREE_SHA,
      stagingTreeSha: TREE_SHA,
      operation: "production-migrations",
      parameters: { includeAllMigrations: false },
      repositoryOwner: "KenLeeYa",
      applyActor: "KenLeeYa",
      ...overrides.expected,
    },
    runMetadata: overrides.runMetadata ?? validMetadata(),
    now: overrides.now ?? new Date("2026-08-02T01:00:00.000Z"),
  });
}

describe("production approval receipts", () => {
  it("creates and validates an immutable receipt for the verified Staging tree", () => {
    expect(validate()).toMatchObject({
      operation: "production-migrations",
      planRunId: "30723323487",
      commitSha: COMMIT_SHA,
    });
  });

  it("canonicalizes parameters before hashing", () => {
    expect(stableJson({ z: 1, a: { y: true, x: false } })).toBe(
      '{"a":{"x":false,"y":true},"z":1}',
    );
  });

  it("rejects a plan created from a tree that differs from Staging", () => {
    expect(() => validReceipt({ stagingTreeSha: "c".repeat(40) })).toThrow(
      "STAGING_TREE_MISMATCH",
    );
  });

  it("rejects modified parameters even when the receipt digest is unchanged", () => {
    const receipt = validReceipt();
    receipt.parameters.includeAllMigrations = true;
    expect(() => validate(receipt)).toThrow("PLAN_PARAMETERS_MISMATCH");
  });

  it("rejects a replay after the 24-hour validity window", () => {
    expect(() =>
      validate(validReceipt(), { now: new Date("2026-08-03T00:00:01.000Z") }),
    ).toThrow("PLAN_EXPIRED");
  });

  it("rejects a plan from another workflow or commit", () => {
    expect(() =>
      validate(validReceipt(), {
        runMetadata: validMetadata({
          path: ".github/workflows/status-page-deploy.yml",
        }),
      }),
    ).toThrow("PLAN_RUN_WORKFLOW_MISMATCH");
    expect(() =>
      validate(validReceipt(), {
        runMetadata: validMetadata({ head_sha: "c".repeat(40) }),
      }),
    ).toThrow("PLAN_RUN_COMMIT_MISMATCH");
  });

  it("requires both the planner and applier to be the repository owner", () => {
    expect(() =>
      validate(validReceipt(), {
        expected: { applyActor: "untrusted-user" },
      }),
    ).toThrow("APPLY_ACTOR_NOT_REPOSITORY_OWNER");
    expect(() =>
      validate(validReceipt({ requestedBy: "untrusted-user" })),
    ).toThrow("PLAN_REQUESTER_NOT_REPOSITORY_OWNER");
  });

  it("requires a completed successful source run", () => {
    expect(() =>
      validate(validReceipt(), {
        runMetadata: validMetadata({ status: "in_progress", conclusion: null }),
      }),
    ).toThrow("PLAN_RUN_NOT_COMPLETED");
  });

  it("accepts a receipt created during a long-running plan", () => {
    const receiptCreatedAt = new Date(NOW.getTime() + 30 * 60_000);
    const receipt = validReceipt({ createdAt: receiptCreatedAt });
    expect(
      validate(receipt, {
        runMetadata: validMetadata({
          updated_at: new Date(NOW.getTime() + 35 * 60_000).toISOString(),
        }),
        now: new Date(NOW.getTime() + 36 * 60_000),
      }),
    ).toMatchObject({ planRunId: "30723323487" });
  });
});
