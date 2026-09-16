import { describe, expect, it, vi } from "vitest";
import { applyDrOperatorUpdate, buildDrOperatorUpdatePlan, validateDrOperatorUpdatePlan } from "./dr-operator-update.mjs";

function input() {
  return {
    source: { commitSha: "a".repeat(40), treeSha: "b".repeat(40), stagingTreeSha: "b".repeat(40) },
    runtime: { backendCode: "DR", backendRole: "READ_ONLY_STANDBY", writesEnabled: false, enforcementEnabled: true, promotionEpoch: 1, supabaseProjectRef: "a".repeat(20) },
    state: {
      primary: { hostname: "app.qidaigo.com", healthStatus: 200,
        alias: { projectId: "prj_primary", deploymentId: "dpl_primary" },
        deployment: { projectId: "prj_primary", id: "dpl_primary", readyState: "READY", backendTarget: "PRIMARY" } },
      project: { id: "prj_dr", name: "stallorder-dr", protection: "all_except_custom_domains" },
      alias: { hostname: "dr.qidaigo.com", projectId: "prj_dr", deploymentId: "dpl_old", deploymentUrl: "old.vercel.app" },
      deployment: { id: "dpl_old", projectId: "prj_dr", readyState: "READY", backendTarget: "DR", url: "old.vercel.app" },
      customDomains: ["dr.qidaigo.com"], operatorEmail: "operator@example.test",
      access: { domain: "dr.qidaigo.com", type: "self_hosted", audience: "a".repeat(64), teamDomain: "https://test.cloudflareaccess.com", accountId: "account",
        policy: { name: "Original", decision: "allow", precedence: 1, include: [{ cloudflare_account_member: { account_id: "account" } }], require: [], exclude: [] } },
    },
  };
}

describe("existing DR update Plan", () => {
  it("binds the existing target, designated operator, source and rollback artifact", () => {
    const plan = buildDrOperatorUpdatePlan(input());
    expect(validateDrOperatorUpdatePlan(plan)).toEqual(plan);
    expect(plan.target.policy.require).toEqual([{ email: { email: "operator@example.test" } }]);
    expect(plan.before.deployment.id).toBe("dpl_old");
    expect(plan.target.projectId).toBe("prj_dr");
  });
  it.each([
    (x) => { x.source.stagingTreeSha = "c".repeat(40); },
    (x) => { x.state.primary.healthStatus = 503; },
    (x) => { x.state.primary.deployment.backendTarget = "DR"; },
    (x) => { x.state.project.id = "prj_primary"; },
    (x) => { x.state.project.protection = null; },
    (x) => { x.state.customDomains.push("app.qidaigo.com"); },
    (x) => { x.runtime.writesEnabled = true; },
    (x) => { x.state.access.policy.include = [{ everyone: {} }]; },
    (x) => { x.state.access.policy.require = [{ email: { email: "another@example.test" } }]; },
  ])("rejects a changed or unsafe boundary", (change) => {
    const fixture = input(); change(fixture);
    expect(() => buildDrOperatorUpdatePlan(fixture)).toThrow();
  });
  it("rejects tampering and expired receipts", () => {
    const plan = buildDrOperatorUpdatePlan(input());
    expect(() => validateDrOperatorUpdatePlan({ ...plan, target: {} })).toThrow("DR_UPDATE_PLAN_INVALID");
    expect(() => validateDrOperatorUpdatePlan({ ...plan, generatedAt: "2000-01-01T00:00:00Z" })).toThrow("DR_UPDATE_PLAN_EXPIRED");
  });
});

function operations(plan, mutate) {
  const state = structuredClone(plan.before);
  return {
    deploy: vi.fn(async () => "https://candidate.vercel.app"),
    assertUnchanged: vi.fn(), verifyCandidate: vi.fn(), verifyPolicy: vi.fn(), assertPrimary: vi.fn(),
    writePolicy: vi.fn(async (policy) => { state.access.policy = policy; }),
    promote: vi.fn(async () => { state.alias = { ...state.alias, deploymentId: "dpl_new", deploymentUrl: "candidate.vercel.app" }; }),
    verifyLive: vi.fn(async () => { if (mutate) { mutate(state); throw new Error("LIVE_FAILED"); } }),
    readState: vi.fn(async () => state), restoreDeployment: vi.fn(), verifyRestored: vi.fn(),
  };
}

describe("existing DR update execution", () => {
  it("verifies the candidate before restricting policy and promoting", async () => {
    const plan = buildDrOperatorUpdatePlan(input()); const ops = operations(plan);
    expect((await applyDrOperatorUpdate(plan, ops)).completed).toBe(true);
    expect(ops.verifyCandidate.mock.invocationCallOrder[0]).toBeLessThan(ops.writePolicy.mock.invocationCallOrder[0]);
    expect(ops.verifyPolicy.mock.invocationCallOrder[0]).toBeLessThan(ops.promote.mock.invocationCallOrder[0]);
    expect(ops.restoreDeployment).not.toHaveBeenCalled();
  });
  it("restores only this update's artifact and policy after live failure", async () => {
    const plan = buildDrOperatorUpdatePlan(input()); const ops = operations(plan, () => {});
    await expect(applyDrOperatorUpdate(plan, ops)).rejects.toThrow("LIVE_FAILED");
    expect(ops.restoreDeployment).toHaveBeenCalledWith(plan.before.deployment);
    expect(ops.writePolicy).toHaveBeenLastCalledWith(plan.before.access.policy);
    expect(ops.verifyRestored).toHaveBeenCalledOnce();
  });
  it.each(["primary", "deployment", "policy"])("does not overwrite a concurrent %s change", async (kind) => {
    const plan = buildDrOperatorUpdatePlan(input()); const ops = operations(plan, (state) => {
      if (kind === "primary") state.primary.alias.deploymentId = "dpl_other";
      if (kind === "deployment") state.alias = { ...state.alias, deploymentId: "dpl_other", deploymentUrl: "other.vercel.app" };
      if (kind === "policy") state.access.policy = { ...state.access.policy, name: "Other operator update" };
    });
    await expect(applyDrOperatorUpdate(plan, ops)).rejects.toThrow(/CONCURRENT/);
    expect(ops.writePolicy).toHaveBeenCalledTimes(1);
    if (kind !== "policy") expect(ops.restoreDeployment).not.toHaveBeenCalled();
  });
});
