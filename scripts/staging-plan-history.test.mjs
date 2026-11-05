import { afterEach, describe, expect, it, vi } from "vitest";
import { createProductionApprovalReceipt } from "./lib/production-approval.mjs";
import { conversionDigest, STAGING_TARGET } from "./dr-staging-conversion-plan.mjs";
import { decodeConsumedPlanZip, validateConsumedRetirementHistory, readProtectedPlanHistory } from "./staging-plan-history.mjs";

const repository = "KenLeeYa/Stallorder-Platform";
const source = "32e9de2cf325240679c1a56f336b4c0f8c9d6664";
const tree = "f585a481acc6718f0aa11aed1a0983c143aa128b";
function fixture() {
  const run = { path: ".github/workflows/dr-staging-conversion.yml", head_branch: "main", head_sha: source,
    status: "completed", run_attempt: 1, event: "workflow_dispatch", actor: { login: "KenLeeYa" },
    triggering_actor: { login: "KenLeeYa" }, repository: { id: 1298874780, full_name: repository },
    head_repository: { id: 1298874780, full_name: repository } };
  const backup = { runId: "39647447270", commit: "291c3c56f1dc6ed743f9c7fe67a117f2dac554ff",
    artifactId: 12368487539, artifactDigest: "sha256:fbab2a1c9b481c60ad4e8d67442c1842055ec72ba0f12d09c18f34ee324f5cd9" };
  const plan = { schemaVersion: 1, sourceSha: source, target: { ...STAGING_TARGET }, backup, migrationCount: 146 };
  const approval = createProductionApprovalReceipt({ repository, planRunId: "39944190461", commitSha: source,
    treeSha: tree, stagingTreeSha: tree, operation: "dr-staging-conversion", requestedBy: "KenLeeYa",
    createdAt: new Date("2026-10-23T11:10:55.482Z"), parameters: { backupRunId: backup.runId,
      primaryWrites: false, targetRef: STAGING_TARGET.ref, transitionSnapshotSha256: conversionDigest(plan) } });
  return { backup, plan, approval, fileCount: 42,
    planRun: { ...run, id: 39944190461, conclusion: "success", created_at: "2026-10-23T11:10:10Z",
      run_started_at: "2026-10-23T11:10:10Z", updated_at: "2026-10-23T11:10:58Z" },
    applyRun: { ...run, id: 39944614570, conclusion: "failure", created_at: "2026-10-23T11:13:46Z",
      run_started_at: "2026-10-23T11:13:46Z", updated_at: "2026-10-23T11:16:43Z" },
    applyJob: { id: 120384090004, run_id: 39944614570, run_attempt: 1, head_sha: source, head_branch: "main",
      name: "conversion", status: "completed", conclusion: "failure", started_at: "2026-10-23T11:13:50Z",
      completed_at: "2026-10-23T11:16:42Z", steps: [
        { number: 18, name: "Bind Apply to the qualified backup and Plan", status: "completed", conclusion: "success",
          started_at: "2026-10-23T11:14:25Z", completed_at: "2026-10-23T11:14:26Z" },
        { number: 21, name: "Apply with backup, drift, Primary and provider boundaries", status: "completed", conclusion: "failure",
          started_at: "2026-10-23T11:14:48Z", completed_at: "2026-10-23T11:16:40Z" },
      ] },
    progress: { sourceSha: source, planDigest: conversionDigest(plan), primaryWrites: false, completed: [
      "immutable-plan", "original-data-matches-qualified-backup", "protected-entry-and-token-edit-permissions",
      "independent-provider-credentials", "old-files-deleted-with-readback", "old-vault-and-private-schemas-retired"] },
    storage: { ref: STAGING_TARGET.ref, sourceSha: source, filesRemoved: 42, exactBackupPaths: true,
      bytesCheckedBeforeDelete: true, authenticatedReadbackMissing: true, primaryWrites: false } };
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("consumed Plan historical reader", () => {
  it("rejects noncanonical, oversized and wrong pinned ZIP bytes without parsing", () => {
    for (const value of [undefined, "", " ", "A".repeat(3345), "A".repeat(3343), "!".repeat(3344),
      Buffer.alloc(2508).toString("base64"), `${"A".repeat(3343)}\n`]) {
      expect(() => decodeConsumedPlanZip(value)).toThrow(/^STAGING_PLAN_HISTORY_FAILED$/);
    }
  });

  it("validates only historical consistency; returns no Plan, approval or execution capability", () => {
    const result = validateConsumedRetirementHistory(fixture());
    expect(result).toEqual({ originalPlanRunId: "39944190461", originalPlanArtifactId: 12497002610,
      failedApplyRunId: "39944614570", backupRunId: "39647447270", historicalConsistencyValidated: true,
      historicalApplyWindowValidated: true, originalPlanConsumed: true, originalApprovalExpired: true,
      diagnosticOnly: true, planQualified: false, applyAuthorized: false, remainingDataProven: false,
      remainingSchemaProven: false, remoteWrites: false });
  });

  it.each(["planRun", "applyRun"])("rejects %s identity and terminal drift", key => {
    for (const change of [{ id: 1 }, { run_attempt: 2 }, { head_sha: "a".repeat(40) }, { path: "other" },
      { head_branch: "staging" }, { event: "push" }, { actor: { login: "other" } },
      { triggering_actor: { login: "other" } }, { status: "in_progress" }, { conclusion: "cancelled" },
      { repository: { id: 2, full_name: repository } }, { head_repository: { id: 1298874780, full_name: "other/fork" } }]) {
      const input = fixture(); Object.assign(input[key], change);
      expect(() => validateConsumedRetirementHistory(input)).toThrow(/^STAGING_PLAN_HISTORY_FAILED$/);
    }
  });

  it("rejects job identity, missing/duplicate/reordered steps and phase result drift", () => {
    for (const change of [{ id: 2 }, { run_id: 2 }, { run_attempt: 2 }, { head_sha: "b".repeat(40) },
      { head_branch: "staging" }, { name: "other" }, { status: "in_progress" }, { conclusion: "success" }]) {
      const input = fixture(); Object.assign(input.applyJob, change);
      expect(() => validateConsumedRetirementHistory(input)).toThrow(/^STAGING_PLAN_HISTORY_FAILED$/);
    }
    for (const mutate of [s => s.pop(), s => s.push(s[0]), s => s.reverse(),
      s => { s[0].conclusion = "skipped"; }, s => { s[1].conclusion = "success"; },
      s => { s[0].name = "other"; }, s => { s[1].number = 20; }]) {
      const input = fixture(); mutate(input.applyJob.steps);
      expect(() => validateConsumedRetirementHistory(input)).toThrow(/^STAGING_PLAN_HISTORY_FAILED$/);
    }
  });

  it("rejects missing, malformed, reversed or outside-approval timestamps without clock override", () => {
    for (const mutate of [x => { x.applyRun.created_at = null; }, x => { x.applyRun.run_started_at = "invalid"; },
      x => { x.applyJob.started_at = "2026-10-23T11:16:43Z"; },
      x => { x.applyJob.completed_at = "2026-10-24T12:00:00Z"; },
      x => { x.applyJob.steps[0].started_at = "2026-10-23T11:10:55Z"; },
      x => { x.applyJob.steps[0].completed_at = "2026-10-23T11:16:39Z"; },
      x => { x.applyJob.steps[1].completed_at = "2026-10-23T11:14:47Z"; },
      x => { x.planRun.updated_at = "2026-10-23T11:15:00Z"; }]) {
      const input = fixture(); mutate(input);
      expect(() => validateConsumedRetirementHistory(input)).toThrow(/^STAGING_PLAN_HISTORY_FAILED$/);
    }
    expect(() => validateConsumedRetirementHistory({ ...fixture(), now: new Date("2026-10-23T12:00:00Z") }))
      .toThrow(/^STAGING_PLAN_HISTORY_FAILED$/);
    expect(() => validateConsumedRetirementHistory(Object.assign(Object.create({ now: new Date() }), fixture())))
      .toThrow(/^STAGING_PLAN_HISTORY_FAILED$/);
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-23T12:00:00Z"));
    expect(() => validateConsumedRetirementHistory(fixture())).toThrow(/^STAGING_PLAN_HISTORY_FAILED$/);
  });

  it("preserves every immutable receipt, backup, target, prefix and Storage check", () => {
    for (const mutate of [x => { x.approval.receiptDigest = "f".repeat(64); },
      x => { x.approval.expiresAt = "2030-01-01T00:00:00Z"; }, x => { x.plan.target.ref = "eyuctbnlvnbnivwasvqr"; },
      x => { x.backup.artifactId = 1; }, x => { x.plan.sourceSha = "f".repeat(40); },
      x => { x.progress.completed.reverse(); }, x => { x.progress.completed.pop(); },
      x => { x.progress.completed.push("reset"); }, x => { x.progress.primaryWrites = true; },
      x => { x.storage.filesRemoved = 41; }, x => { x.storage.bytesCheckedBeforeDelete = false; },
      x => { x.storage.authenticatedReadbackMissing = false; }]) {
      const input = fixture(); mutate(input);
      expect(() => validateConsumedRetirementHistory(input)).toThrow(/^STAGING_PLAN_HISTORY_FAILED$/);
    }
  });

  it("requires explicit historical mode and protected invocation before reading transport or network", async () => {
    vi.stubGlobal("fetch", vi.fn()); vi.stubEnv("GITHUB_ACTIONS", "false");
    for (const input of [undefined, {}, { mode: "auto" }, { mode: "consumed-plan-history-v1", now: new Date() },
      { mode: "consumed-plan-history-v1" }]) {
      await expect(readProtectedPlanHistory(input)).rejects.toThrow(/^STAGING_PLAN_HISTORY_FAILED$/);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
