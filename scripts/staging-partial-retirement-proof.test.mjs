import { describe, expect, it } from "vitest";
import { createProductionApprovalReceipt } from "./lib/production-approval.mjs";
import { conversionDigest, STAGING_TARGET } from "./dr-staging-conversion-plan.mjs";
import { readFailedRetirementEntryEvidence, readFailedRetirementEvidence, validateFailedRetirementEvidence } from "./staging-partial-retirement-proof.mjs";

const source = "32e9de2cf325240679c1a56f336b4c0f8c9d6664";
const tree = "f585a481acc6718f0aa11aed1a0983c143aa128b";
const checkpoints = ["immutable-plan", "original-data-matches-qualified-backup",
  "protected-entry-and-token-edit-permissions", "independent-provider-credentials",
  "old-files-deleted-with-readback", "old-vault-and-private-schemas-retired"];

function fixture() {
  const run = { path: ".github/workflows/dr-staging-conversion.yml", head_branch: "main",
    head_sha: source, status: "completed", run_attempt: 1, event: "workflow_dispatch",
    repository: { full_name: "KenLeeYa/Stallorder-Platform" }, actor: { login: "KenLeeYa" },
    triggering_actor: { login: "KenLeeYa" }, created_at: "2026-10-23T11:10:00Z", updated_at: "2026-10-23T11:17:00Z" };
  const backup = { runId: "39647447270", commit: "291c3c56f1dc6ed743f9c7fe67a117f2dac554ff",
    artifactId: 12368487539, artifactDigest: "sha256:fbab2a1c9b481c60ad4e8d67442c1842055ec72ba0f12d09c18f34ee324f5cd9" };
  const plan = { schemaVersion: 1, sourceSha: source, target: { ...STAGING_TARGET }, backup, migrationCount: 146 };
  const approval = createProductionApprovalReceipt({ repository: run.repository.full_name,
    planRunId: "39944190461", commitSha: source, treeSha: tree, stagingTreeSha: tree,
    operation: "dr-staging-conversion", requestedBy: "KenLeeYa", createdAt: new Date("2026-10-23T11:10:55.482Z"),
    parameters: { backupRunId: backup.runId, primaryWrites: false, targetRef: STAGING_TARGET.ref,
      transitionSnapshotSha256: conversionDigest(plan) } });
  return { applyRun: { ...run, id: 39944614570, conclusion: "failure" },
    planRun: { ...run, id: 39944190461, conclusion: "success" }, plan, approval, backup,
    progress: { sourceSha: source, planDigest: conversionDigest(plan), completed: [...checkpoints], primaryWrites: false },
    storage: { ref: STAGING_TARGET.ref, sourceSha: source, filesRemoved: 42, exactBackupPaths: true,
      bytesCheckedBeforeDelete: true, authenticatedReadbackMissing: true, primaryWrites: false },
    fileCount: 42, now: new Date("2026-10-23T12:00:00Z") };
}

describe("failed retirement proof provenance", () => {
  it("validates the consumed Plan only as history, never as restored-data or Apply qualification", () => {
    const result = validateFailedRetirementEvidence(fixture());
    expect(result).toEqual({ failedApplyRunId: "39944614570", consumedPlanRunId: "39944190461",
      backupRunId: "39647447270", diagnosticOnly: true, planQualified: false,
      provenanceValidated: true, remainingDataProven: false, remoteWrites: false });
  });

  it.each(["applyRun", "planRun"])("rejects every %s identity or terminal-state mismatch", (key) => {
    for (const change of [{ id: 99 }, { run_attempt: 2 }, { head_sha: "f".repeat(40) },
      { path: ".github/workflows/ci.yml" }, { head_branch: "staging" }, { event: "push" },
      { repository: { full_name: "untrusted/repository" } }, { actor: { login: "not-owner" } },
      { triggering_actor: { login: "not-owner" } }, { status: "in_progress" }, { conclusion: "cancelled" }]) {
      const input = fixture();
      Object.assign(input[key], change);
      expect(() => validateFailedRetirementEvidence(input)).toThrow("STAGING_PARTIAL_RUN_INVALID");
    }
  });

  it.each([
    ["missing", checkpoints.slice(0, -1)], ["reordered", [...checkpoints].reverse()],
    ["duplicate", [...checkpoints, checkpoints[5]]], ["later", [...checkpoints, "synthetic-only-isolation"]],
  ])("rejects %s checkpoints", (_name, completed) => {
    const input = fixture();
    input.progress.completed = completed;
    expect(() => validateFailedRetirementEvidence(input)).toThrow("STAGING_PARTIAL_CHECKPOINT_MISMATCH");
  });

  it("rejects checkpoint source, Plan binding, Primary-write and extra-field drift", () => {
    for (const change of [{ sourceSha: "a".repeat(40) }, { planDigest: "b".repeat(64) },
      { primaryWrites: true }, { arbitrarySnapshotAccepted: true }]) {
      const input = fixture(); Object.assign(input.progress, change);
      expect(() => validateFailedRetirementEvidence(input)).toThrow("STAGING_PARTIAL_CHECKPOINT_MISMATCH");
    }
  });

  it("rejects wrong original backup and target even when a receipt was freshly recomputed", () => {
    for (const mutate of [input => { input.backup = { ...input.backup, runId: "999" }; },
      input => { input.plan.backup = { ...input.plan.backup, artifactId: 123 }; },
      input => { input.plan.target.ref = "eyuctbnlvnbnivwasvqr"; },
      input => { input.plan.target.project = input.plan.target.primaryProject; },
      input => { input.plan.sourceSha = "a".repeat(40); },
      input => { input.plan.migrationCount = 147; }]) {
      const input = fixture(); mutate(input);
      expect(() => validateFailedRetirementEvidence(input)).toThrow(/^STAGING_PARTIAL_(BACKUP|PLAN)_MISMATCH$/);
    }
  });

  it("retains immutable approval, expiry and consumed-Plan binding checks", () => {
    for (const change of [{ planRunId: "999" }, { receiptDigest: "a".repeat(64) },
      { parameters: { primaryWrites: false } }, { treeSha: "a".repeat(40) }]) {
      const input = fixture(); Object.assign(input.approval, change);
      expect(() => validateFailedRetirementEvidence(input)).toThrow("STAGING_PARTIAL_APPROVAL_INVALID");
    }
    const expired = fixture(); expired.now = new Date("2026-10-24T12:00:00Z");
    expect(() => validateFailedRetirementEvidence(expired)).toThrow("STAGING_PARTIAL_APPROVAL_INVALID");
  });

  it("requires all original file bytes, paths and authenticated missing readback", () => {
    for (const change of [{ filesRemoved: 41 }, { ref: "eyuctbnlvnbnivwasvqr" },
      { sourceSha: "a".repeat(40) }, { exactBackupPaths: false }, { bytesCheckedBeforeDelete: false },
      { authenticatedReadbackMissing: false }, { primaryWrites: true }]) {
      const input = fixture(); Object.assign(input.storage, change);
      expect(() => validateFailedRetirementEvidence(input)).toThrow("STAGING_PARTIAL_STORAGE_RECEIPT_INVALID");
    }
    const input = fixture(); input.fileCount = 41;
    expect(() => validateFailedRetirementEvidence(input)).toThrow("STAGING_PARTIAL_STORAGE_RECEIPT_INVALID");
  });

  it("rejects unauthenticated artifact bytes before reading any supplied receipt", () => {
    expect(() => readFailedRetirementEvidence({ ...fixture(), applyZip: Buffer.from("not the approved ZIP") }))
      .toThrow("STAGING_PARTIAL_ARCHIVE_INVALID");
  });

  it("cannot accept caller-extracted entry or Primary state instead of authenticated archives", () => {
    expect(() => readFailedRetirementEntryEvidence({ ...fixture(), entry: { ready: true },
      primary: { deploymentId: "arbitrary" }, applyZip: Buffer.from("not the approved ZIP") }))
      .toThrow("STAGING_PARTIAL_ARCHIVE_INVALID");
  });
});
