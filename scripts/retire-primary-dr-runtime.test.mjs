import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  retirementParameters, selectRetirementBindings, assertRetirementDeployment,
} from "./retire-primary-dr-runtime.mjs";

const primaryId = "prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP";
const sha = "a".repeat(40);
const binding = { id: "owned-binding", key: "DR_SUPABASE_URL", target: ["production"],
  type: "encrypted", updatedAt: 12, value: "must-not-be-recorded" };

describe("Primary DR runtime retirement", () => {
  it("keeps retirement Plan-bound and removes settings only after live Production smoke", () => {
    const workflow = readFileSync(new URL("../.github/workflows/production-application-release.yml", import.meta.url), "utf8");
    expect(workflow).toContain("retire_dr_runtime:");
    expect(workflow).toContain("node scripts/retire-primary-dr-runtime.mjs plan");
    expect(workflow.indexOf("production-approval.mjs verify")).toBeLessThan(
      workflow.indexOf("node scripts/retire-primary-dr-runtime.mjs verify"));
    expect(workflow.indexOf("name: Promote approved application deployment and smoke Production")).toBeLessThan(
      workflow.indexOf("node scripts/retire-primary-dr-runtime.mjs retire"));
    expect(workflow).toContain('--meta "dr_runtime_retired=true"');
    expect(workflow).toContain('vercel rollback "$RETIREMENT_RECOVERY_DEPLOYMENT"');
  });
  it("selects only exact Production-only DR bindings without retaining values", () => {
    const selected = selectRetirementBindings([binding,
      { ...binding, id: "preview-binding", target: ["preview"] },
      { ...binding, id: "primary-binding", key: "PRIMARY_SUPABASE_URL" },
    ]);
    expect(selected).toEqual([{ id: binding.id, key: binding.key, target: ["production"],
      type: binding.type, updatedAt: binding.updatedAt }]);
    expect(JSON.stringify(selected)).not.toContain(binding.value);
  });
  it("rejects shared-environment, branch-specific and unexpected DR bindings", () => {
    for (const changed of [
      { target: ["production", "preview"] }, { gitBranch: "someone-else" },
      { key: "DR_UNREVIEWED_SETTING" }, { id: "../another-target" },
    ]) expect(() => selectRetirementBindings([{ ...binding, ...changed }])).toThrow();
  });
  it("binds the retirement snapshot to distinct approval parameters", () => {
    const first = retirementParameters({ revision: sha, bindings: [binding.id] });
    expect(first).toMatchObject({ databaseChanges: false, edgeFunctionChanges: false,
      retireDrRuntime: true });
    expect(first.retirementSnapshotSha256).not.toEqual(
      retirementParameters({ revision: sha, bindings: [] }).retirementSnapshotSha256);
  });
  it("requires the exact promoted Primary revision and retirement marker before deleting bindings", () => {
    const deployment = { id: "dpl_owned", projectId: primaryId, target: "production",
      readyState: "READY", url: "owned.vercel.app",
      meta: { git_commit: sha, dr_runtime_retired: "true" } };
    const alias = { projectId: primaryId, deploymentId: deployment.id };
    expect(() => assertRetirementDeployment(deployment, alias, sha, "https://owned.vercel.app")).not.toThrow();
    for (const changed of [
      { projectId: "prj_GOSwYN5rKhSuD3d4gPJEVtmKt7b3" }, { target: "preview" },
      { readyState: "ERROR" }, { meta: { git_commit: "b".repeat(40), dr_runtime_retired: "true" } },
      { meta: { git_commit: sha } },
    ]) expect(() => assertRetirementDeployment({ ...deployment, ...changed }, alias, sha,
      "https://owned.vercel.app")).toThrow();
    expect(() => assertRetirementDeployment(deployment, { ...alias, deploymentId: "dpl_other" },
      sha, "https://owned.vercel.app")).toThrow();
  });
});
