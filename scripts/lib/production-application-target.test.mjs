import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import {
  applicationPlanParameters, assertApplicationPrimary, captureApplicationBaseline,
  verifyApplicationRecovery, verifyApplicationTarget,
  readApplicationRuntime,
  settleApplicationPromotion, verifyApplicationRecoveryAdmission,
} from "../production-application-target.mjs";
import { createProductionApprovalReceipt, validateProductionApprovalReceipt } from "./production-approval.mjs";

const project = "prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP";
const team = "team_MMfsiG94K9Zy3e6w7Ccc9xY4";
const beforeSha = "a".repeat(40), afterSha = "b".repeat(40);
const expected = {
  STALLORDER_RESILIENCE_MODE: "PRIMARY_ONLY", RELEASE_PROMOTION_EPOCH: "3",
  RELEASE_PRIMARY_DEPLOYMENT_ID: "dpl_healthy", RELEASE_PRIMARY_SHA: beforeSha,
  RELEASE_HEALTHY_DEPLOYMENT_ID: "dpl_healthy", RELEASE_HEALTHY_SHA: beforeSha,
  APPROVED_PRODUCTION_DEPLOYMENT: "https://candidate.vercel.app", GITHUB_SHA: afterSha,
};
const recoveryAdmission = { projectId: project, teamId: team, deploymentId: "dpl_candidate", sha: afterSha,
  status: "PROMOTION_SETTLED", safeToRecover: true,
  observations: [{ jobStatus: "failed", requestedAt: 1, toDeploymentId: "dpl_candidate", type: "promote" }] };

function fixture() {
  const owner = { id: project, accountId: team, targets: { production: { id: "dpl_healthy" } } };
  const healthy = { id: "dpl_healthy", url: "healthy.vercel.app", projectId: project, target: "production", readyState: "READY", meta: { git_commit: beforeSha } };
  const candidate = { ...healthy, id: "dpl_candidate", url: "candidate.vercel.app", meta: { git_commit: afterSha } };
  const aliases = { healthy: { aliases: [{ alias: "app.qidaigo.com" }] }, candidate: { aliases: [] } };
  const api = vi.fn(async (path) => {
    expect(path).toContain(`?teamId=${team}`);
    if (path.startsWith("/v9/projects/")) return owner;
    if (path.startsWith("/v13/deployments/dpl_healthy?")) return healthy;
    if (path.startsWith("/v13/deployments/candidate.vercel.app?")) return candidate;
    if (path.startsWith("/v13/deployments/dpl_candidate?")) return candidate;
    if (path.startsWith("/v2/deployments/dpl_healthy/aliases?")) return aliases.healthy;
    if (path.startsWith("/v2/deployments/dpl_candidate/aliases?")) return aliases.candidate;
    throw new Error(`Unexpected provider endpoint: ${path}`);
  });
  const runtime = vi.fn(async (origin) => ({ connectivity: "ready", loginStatus: 200, availability: { mode: "NORMAL_PRIMARY", activeBackend: "PRIMARY", promotionEpoch: 3 }, version: { revision: origin === "https://candidate.vercel.app"
      || (origin === "https://app.qidaigo.com" && owner.targets.production.id === "dpl_candidate") ? afterSha : beforeSha,
  } }));
  return { owner, healthy, candidate, aliases, api, runtime };
}

describe("application-only provider identity readback", () => {
  it.each(["succeeded", "failed", "skipped"])("admits recovery only for the exact terminal %s job", async (jobStatus) => {
    const f = fixture(), baseline = await captureApplicationBaseline(expected, f.api, f.runtime);
    f.owner.lastAliasRequest = { jobStatus: "succeeded", requestedAt: 5, toDeploymentId: "dpl_healthy", type: "promote" };
    const candidate = await verifyApplicationTarget(expected, baseline, f.api, false, f.runtime);
    f.owner.lastAliasRequest = { jobStatus, requestedAt: 6, toDeploymentId: "dpl_candidate", type: "promote" };
    const receipt = await settleApplicationPromotion(candidate, expected, f.api, async () => { throw new Error("unexpected wait"); });
    expect(receipt).toMatchObject({ status: "PROMOTION_SETTLED", safeToRecover: true, deploymentId: "dpl_candidate", sha: afterSha });
    expect(receipt.observations).toEqual([{ jobStatus, requestedAt: 6, toDeploymentId: "dpl_candidate", type: "promote" }]);
  });

  it("leaves an active job pending after bounded reads without a second write", async () => {
    const f = fixture(), baseline = await captureApplicationBaseline(expected, f.api, f.runtime);
    const candidate = await verifyApplicationTarget(expected, baseline, f.api, false, f.runtime);
    f.owner.lastAliasRequest = { jobStatus: "pending", requestedAt: 1, toDeploymentId: "dpl_candidate", type: "promote" };
    const wait = vi.fn(async () => {});
    const receipt = await settleApplicationPromotion(candidate, expected, f.api, wait);
    expect(receipt).toMatchObject({ status: "PROMOTION_PENDING", safeToRecover: false });
    expect(receipt.observations).toHaveLength(12);
    expect(wait).toHaveBeenCalledTimes(11);
  });

  it.each([
    ["absent", (f) => { delete f.owner.lastAliasRequest; }],
    ["unknown state", (f) => { f.owner.lastAliasRequest.jobStatus = "mystery"; }],
    ["wrong destination", (f) => { f.owner.lastAliasRequest.toDeploymentId = "dpl_other"; }],
    ["rollback", (f) => { f.owner.lastAliasRequest.type = "rollback"; }],
    ["old request", (f) => { f.owner.lastAliasRequest.requestedAt = 5; }],
    ["bad timestamp", (f) => { f.owner.lastAliasRequest.requestedAt = "6"; }],
    ["other Primary", (f) => { f.owner.targets.production.id = "dpl_other"; }],
    ["other team", (f) => { f.owner.accountId = "team_other"; }],
    ["rolling release", (f) => { f.owner.rollingRelease = {}; }],
    ["wrong source", (f) => { f.candidate.meta.git_commit = beforeSha; }],
  ])("refuses recovery for an unproven %s result without retrying", async (_, change) => {
    const f = fixture(), baseline = await captureApplicationBaseline(expected, f.api, f.runtime);
    f.owner.lastAliasRequest = { jobStatus: "succeeded", requestedAt: 5, toDeploymentId: "dpl_healthy", type: "promote" };
    const candidate = await verifyApplicationTarget(expected, baseline, f.api, false, f.runtime);
    f.owner.lastAliasRequest = { jobStatus: "succeeded", requestedAt: 6, toDeploymentId: "dpl_candidate", type: "promote" };
    change(f);
    const wait = vi.fn();
    const receipt = await settleApplicationPromotion(candidate, expected, f.api, wait);
    expect(receipt).toMatchObject({ status: "PROMOTION_UNKNOWN", safeToRecover: false });
    expect(wait).not.toHaveBeenCalled();
  });

  it("does not follow a replacement job even when it promotes the same deployment", async () => {
    const f = fixture(), baseline = await captureApplicationBaseline(expected, f.api, f.runtime);
    const candidate = await verifyApplicationTarget(expected, baseline, f.api, false, f.runtime);
    f.owner.lastAliasRequest = { jobStatus: "pending", requestedAt: 6, toDeploymentId: "dpl_candidate", type: "promote" };
    const receipt = await settleApplicationPromotion(candidate, expected, f.api, async () => {
      f.owner.lastAliasRequest = { ...f.owner.lastAliasRequest, requestedAt: 7, jobStatus: "succeeded" };
    });
    expect(receipt).toMatchObject({ status: "PROMOTION_UNKNOWN", safeToRecover: false, reason: "RELEASE_PROMOTION_JOB_CHANGED" });
    expect(receipt.observations).toHaveLength(1);
  });

  it("preserves the last observed job on read failure without leaking or retrying", async () => {
    const f = fixture(), baseline = await captureApplicationBaseline(expected, f.api, f.runtime);
    const candidate = await verifyApplicationTarget(expected, baseline, f.api, false, f.runtime);
    f.owner.lastAliasRequest = { jobStatus: "pending", requestedAt: 6, toDeploymentId: "dpl_candidate", type: "promote" };
    const receipt = await settleApplicationPromotion(candidate, expected, f.api, async () => {
      f.api.mockRejectedValue(new Error("Bearer secret-fixture"));
    });
    expect(receipt).toMatchObject({ status: "PROMOTION_UNKNOWN", safeToRecover: false, reason: "RELEASE_PROMOTION_READ_FAILED" });
    expect(receipt.observations).toHaveLength(1);
    expect(JSON.stringify(receipt)).not.toContain("secret-fixture");
  });

  it("waits for the same old-but-active provider job before allowing recovery", async () => {
    const f = fixture();
    const baseline = await captureApplicationBaseline(expected, f.api, f.runtime);
    const candidate = await verifyApplicationTarget(expected, baseline, f.api, false, f.runtime);
    f.owner.lastAliasRequest = { jobStatus: "in-progress", requestedAt: 1, toDeploymentId: "dpl_candidate", type: "promote" };
    const wait = vi.fn(async () => { f.owner.lastAliasRequest.jobStatus = "failed"; });
    const receipt = await settleApplicationPromotion(candidate, expected, f.api, wait);
    expect(receipt.status).toBe("PROMOTION_SETTLED");
    expect(receipt.safeToRecover).toBe(true);
    expect(receipt.observations.map((job) => job.jobStatus)).toEqual(["in-progress", "failed"]);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it.each(["pending", "in-progress"])("blocks a new promotion while an old %s alias request still exists", async (jobStatus) => {
    const f = fixture();
    const baseline = await captureApplicationBaseline(expected, f.api, f.runtime);
    f.owner.lastAliasRequest = { jobStatus, requestedAt: 1, toDeploymentId: "dpl_other", type: "promote" };
    await expect(verifyApplicationTarget(expected, baseline, f.api, false, f.runtime)).rejects.toThrow("RELEASE_PROMOTION_PENDING");
  });

  it.each(["failed", "skipped"])("does not certify a %s promotion as success even when aliases match", async (jobStatus) => {
    const f = fixture(), baseline = await captureApplicationBaseline(expected, f.api, f.runtime);
    f.owner.targets.production.id = "dpl_candidate";
    f.aliases.candidate.aliases = [{ alias: "app.qidaigo.com" }];
    f.owner.lastAliasRequest = { jobStatus, requestedAt: 1, toDeploymentId: "dpl_candidate", type: "promote" };
    await expect(verifyApplicationTarget(expected, baseline, f.api, true, f.runtime)).rejects.toThrow("RELEASE_PROMOTION_NOT_SUCCEEDED");
  });

  it.each(["pending", "failed", "skipped", "absent"])("does not certify recovery with %s provider evidence", async (jobStatus) => {
    const f = fixture(), baseline = await captureApplicationBaseline(expected, f.api, f.runtime);
    if (jobStatus !== "absent") f.owner.lastAliasRequest = { jobStatus, requestedAt: 1, toDeploymentId: "dpl_healthy", type: "promote" };
    await expect(verifyApplicationRecovery(baseline, expected, f.api, f.runtime, recoveryAdmission)).rejects.toThrow("RELEASE_RECOVERY_JOB_UNPROVEN");
  });

  it("rejects an old successful recovery record that predates this promotion", async () => {
    const f = fixture(), baseline = await captureApplicationBaseline(expected, f.api, f.runtime);
    f.owner.lastAliasRequest = { jobStatus: "succeeded", requestedAt: 1, toDeploymentId: "dpl_healthy", type: "promote" };
    await expect(verifyApplicationRecovery(baseline, expected, f.api, f.runtime, recoveryAdmission)).rejects.toThrow("RELEASE_RECOVERY_JOB_UNPROVEN");
  });

  it("preserves an active legacy Primary while qualifying a separate Primary-only recovery artifact", async () => {
    const f = fixture();
    f.owner.targets.production.id = "dpl_legacy";
    f.healthy.url = "healthy.vercel.app";
    f.aliases.healthy.aliases = [];
    const invocation = { ...expected, RELEASE_PRIMARY_DEPLOYMENT_ID: "dpl_legacy", RELEASE_PRIMARY_SHA: "c".repeat(40) };
    const api = async (path) => {
      if (path.startsWith("/v13/deployments/dpl_legacy?")) return { ...f.healthy, id: "dpl_legacy", meta: { git_commit: invocation.RELEASE_PRIMARY_SHA } };
      if (path.startsWith("/v2/deployments/dpl_legacy/aliases?")) return { aliases: [{ alias: "app.qidaigo.com" }] };
      return f.api(path);
    };
    const runtime = vi.fn(async origin => {
      const result = await f.runtime(origin);
      if (origin === "https://app.qidaigo.com" && f.owner.targets.production.id === "dpl_legacy") result.version.revision = invocation.RELEASE_PRIMARY_SHA;
      return result;
    });
    const baseline = await captureApplicationBaseline(invocation, api, runtime);
    expect(baseline.deploymentId).toBe("dpl_legacy");
    expect(baseline.recovery).toMatchObject({ deploymentId: "dpl_healthy", sha: beforeSha, resilienceMode: "PRIMARY_ONLY" });
    expect(runtime).toHaveBeenCalledWith("https://healthy.vercel.app");
    expect((await verifyApplicationTarget(invocation, baseline, api, false, runtime)).status).toBe("CANDIDATE_READBACK_VERIFIED");
    f.owner.targets.production.id = "dpl_candidate";
    f.owner.lastAliasRequest = { jobStatus: "succeeded", requestedAt: 1, toDeploymentId: "dpl_candidate", type: "promote" };
    f.aliases.candidate.aliases = [{ alias: "app.qidaigo.com" }];
    expect((await verifyApplicationTarget(invocation, baseline, api, true, runtime)).status).toBe("PROMOTION_READBACK_VERIFIED");
    f.owner.targets.production.id = "dpl_healthy";
    f.aliases.candidate.aliases = [];
    f.aliases.healthy.aliases = [{ alias: "app.qidaigo.com" }];
    f.owner.lastAliasRequest = { jobStatus: "succeeded", requestedAt: 2, toDeploymentId: "dpl_healthy", type: "promote" };
    expect((await verifyApplicationRecovery(baseline, invocation, api, runtime, recoveryAdmission)).deploymentId).toBe("dpl_healthy");
  });

  it.each(["baseline", "candidate", "promoted", "recovered"])("rejects absent, legacy or wrong-source runtime evidence at %s", async (stage) => {
    const f = fixture(), baseline = await captureApplicationBaseline(expected, f.api, f.runtime);
    if (stage === "promoted") {
      f.owner.targets.production.id = "dpl_candidate";
      f.aliases.candidate.aliases = [{ alias: "app.qidaigo.com" }];
    }
    for (const body of [undefined, { status: "ok", health: "HEALTHY" },
      { connectivity: "ready", loginStatus: 200, availability: { mode: "NORMAL_DR", activeBackend: "DR", promotionEpoch: 3 }, version: { revision: beforeSha } },
      { connectivity: "ready", loginStatus: 200, availability: { mode: "NORMAL_PRIMARY", activeBackend: "PRIMARY", promotionEpoch: 3 }, version: { revision: "c".repeat(40) } },
      { connectivity: "degraded", loginStatus: 200, availability: { mode: "NORMAL_PRIMARY", activeBackend: "PRIMARY", promotionEpoch: 3 }, version: { revision: beforeSha } }]) {
      const runtime = async () => body;
      const result = stage === "baseline" ? captureApplicationBaseline(expected, f.api, runtime)
        : stage === "recovered" ? verifyApplicationRecovery(baseline, expected, f.api, runtime)
          : verifyApplicationTarget(expected, baseline, f.api, stage === "promoted", runtime);
      await expect(result).rejects.toThrow("RELEASE_RUNTIME_DRIFT");
    }
  });

  it("requires an exact Primary-only mode and both source identities before provider access", () => {
    for (const mode of [undefined, "", "LEGACY_DR", "primary_only"]) {
      expect(() => applicationPlanParameters({ ...expected, STALLORDER_RESILIENCE_MODE: mode })).toThrow("RELEASE_RESILIENCE_MODE_REQUIRED");
    }
    for (const key of ["RELEASE_PRIMARY_DEPLOYMENT_ID", "RELEASE_PRIMARY_SHA"]) {
      expect(() => applicationPlanParameters({ ...expected, [key]: undefined })).toThrow("RELEASE_PRIMARY_TARGET_REQUIRED");
    }
  });

  it("rejects aliases changed while the separate recovery runtime is being checked", async () => {
    const f = fixture();
    const runtime = async (origin) => {
      const result = await f.runtime(origin);
      if (!f.aliases.healthy.aliases.some(row => row.alias === "unexpected.example.com"))
        f.aliases.healthy.aliases.push({ alias: "unexpected.example.com" });
      return result;
    };
    await expect(captureApplicationBaseline(expected, f.api, runtime)).rejects.toThrow("RELEASE_PRIMARY_CHANGED");
  });
  it.each([undefined, "PRIMARY"])("verifies baseline, candidate, promotion and recovery with backend metadata %s", async (backend) => {
    const f = fixture();
    if (backend !== undefined) {
      f.healthy.meta.backend_target = backend;
      f.candidate.meta.backend_target = backend;
    }
    const baseline = await captureApplicationBaseline(expected, f.api, f.runtime);
    expect((await verifyApplicationTarget(expected, baseline, f.api, false, f.runtime)).status).toBe("CANDIDATE_READBACK_VERIFIED");
    f.owner.targets.production.id = "dpl_candidate";
    f.owner.lastAliasRequest = { jobStatus: "succeeded", requestedAt: 1, toDeploymentId: "dpl_candidate", type: "promote" };
    f.aliases.candidate.aliases = [{ alias: "app.qidaigo.com" }];
    expect((await verifyApplicationTarget(expected, baseline, f.api, true, f.runtime)).status).toBe("PROMOTION_READBACK_VERIFIED");
    f.owner.targets.production.id = "dpl_healthy";
    f.owner.lastAliasRequest = { jobStatus: "succeeded", requestedAt: 2, toDeploymentId: "dpl_healthy", type: "promote" };
    expect((await verifyApplicationRecovery(baseline, expected, f.api, f.runtime, recoveryAdmission)).status).toBe("RECOVERY_READBACK_VERIFIED");
  });

  it.each(["baseline", "candidate", "promoted", "recovered", "candidate baseline"])("rejects explicit DR backend at %s despite matching project, revision and aliases", async (stage) => {
    const f = fixture(), baseline = await captureApplicationBaseline(expected, f.api, f.runtime);
    const deployment = ["candidate", "promoted"].includes(stage) ? f.candidate : f.healthy;
    deployment.meta.backend_target = "DR";
    if (stage === "promoted") {
      f.owner.targets.production.id = "dpl_candidate";
      f.aliases.candidate.aliases = [{ alias: "app.qidaigo.com" }];
    }
    const readback = stage === "baseline" ? captureApplicationBaseline(expected, f.api, f.runtime)
      : stage === "recovered" ? verifyApplicationRecovery(baseline, expected, f.api, f.runtime)
        : verifyApplicationTarget(expected, baseline, f.api, stage === "promoted", f.runtime);
    await expect(readback).rejects.toThrow("RELEASE_BACKEND_TARGET_DRIFT");
  });

  it.each([
    ["project", (f) => { f.owner.id = "prj_other"; }],
    ["team", (f) => { f.owner.accountId = "team_other"; }],
    ["pointer", (f) => { f.owner.targets.production.id = "dpl_other"; }],
    ["deployment", (f) => { f.healthy.id = "dpl_other"; }],
    ["deployment project", (f) => { f.healthy.projectId = "prj_other"; }],
    ["preview", (f) => { f.healthy.target = "preview"; }],
    ["not ready", (f) => { f.healthy.readyState = "ERROR"; }],
    ["sha", (f) => { f.healthy.meta.git_commit = afterSha; }],
    ["conflicting sha metadata", (f) => { f.healthy.meta.githubCommitSha = afterSha; }],
    ["missing alias", (f) => { f.aliases.healthy.aliases = []; }],
    ["incomplete alias page", (f) => { f.aliases.healthy.pagination = { next: "cursor" }; }],
    ["duplicate alias", (f) => { f.aliases.healthy.aliases.push({ alias: "app.qidaigo.com" }); }],
    ["malformed alias", (f) => { f.aliases.healthy.aliases.push(null); }],
  ])("rejects baseline %s drift", async (_, change) => {
    const f = fixture(); change(f);
    await expect(captureApplicationBaseline(expected, f.api, f.runtime)).rejects.toThrow(/^RELEASE_/u);
  });

  it.each([
    ["candidate sha", (f) => { f.candidate.meta.git_commit = beforeSha; }],
    ["candidate project", (f) => { f.candidate.projectId = "prj_other"; }],
    ["candidate URL", (f) => { f.candidate.url = "other.vercel.app"; }],
    ["Primary alias moved", (f) => { f.aliases.healthy.aliases = [{ alias: "other.example.com" }]; }],
    ["early promotion", (f) => { f.owner.targets.production.id = "dpl_candidate"; }],
    ["early domain assignment", (f) => { f.aliases.candidate.aliases = [{ alias: "app.qidaigo.com" }]; }],
  ])("rejects %s before promotion", async (_, change) => {
    const f = fixture(), baseline = await captureApplicationBaseline(expected, f.api, f.runtime);
    change(f);
    await expect(verifyApplicationTarget(expected, baseline, f.api, false, f.runtime)).rejects.toThrow(/^RELEASE_/u);
  });

  it("rejects promotion without the complete original alias set", async () => {
    const f = fixture(), baseline = await captureApplicationBaseline(expected, f.api, f.runtime);
    f.owner.targets.production.id = "dpl_candidate";
    f.aliases.candidate.aliases = [{ alias: "app.qidaigo.com" }, { alias: "unexpected.example.com" }];
    await expect(verifyApplicationTarget(expected, baseline, f.api, true, f.runtime)).rejects.toThrow("RELEASE_PROMOTION_DRIFT");
  });

  it("rejects incomplete recovery even with the expected healthy deployment", async () => {
    const f = fixture(), baseline = await captureApplicationBaseline(expected, f.api, f.runtime);
    f.aliases.healthy.aliases.push({ alias: "unexpected.example.com" });
    await expect(verifyApplicationRecovery(baseline, expected, f.api, f.runtime)).rejects.toThrow("RELEASE_RECOVERY_DRIFT");
  });

  it.each([false, true])("rejects a different revision when caller inputs change during readback (promoted=%s)", async (promoted) => {
    const f = fixture(), baseline = await captureApplicationBaseline(expected, f.api, f.runtime);
    const invocation = { ...expected }, otherSha = "c".repeat(40);
    f.candidate.meta.git_commit = otherSha;
    if (promoted) {
      f.owner.targets.production.id = "dpl_candidate";
      f.aliases.candidate.aliases = [{ alias: "app.qidaigo.com" }];
    }
    const api = async (path) => {
      const result = await f.api(path);
      invocation.GITHUB_SHA = otherSha;
      return result;
    };
    await expect(verifyApplicationTarget(invocation, baseline, api, promoted, f.runtime)).rejects.toThrow("RELEASE_DEPLOYMENT_DRIFT");
  });

  it.each([false, true])("returns the revision actually verified despite a later caller mutation (promoted=%s)", async (promoted) => {
    const f = fixture(), baseline = await captureApplicationBaseline(expected, f.api, f.runtime);
    const invocation = { ...expected };
    if (promoted) {
      f.owner.targets.production.id = "dpl_candidate";
      f.owner.lastAliasRequest = { jobStatus: "succeeded", requestedAt: 1, toDeploymentId: "dpl_candidate", type: "promote" };
      f.aliases.candidate.aliases = [{ alias: "app.qidaigo.com" }];
    }
    const api = async (path) => {
      const result = await f.api(path);
      if (path.startsWith("/v2/deployments/dpl_candidate/aliases?")) invocation.GITHUB_SHA = "c".repeat(40);
      return result;
    };
    expect((await verifyApplicationTarget(invocation, baseline, api, promoted, f.runtime)).sha).toBe(afterSha);
  });

  it.each(["recovered", "candidate", "promoted"])("compares %s aliases with the baseline supplied at entry", async (stage) => {
    const f = fixture(), baseline = await captureApplicationBaseline(expected, f.api, f.runtime);
    const aliases = [{ alias: "app.qidaigo.com" }, { alias: "unexpected.example.com" }];
    if (stage === "promoted") {
      f.owner.targets.production.id = "dpl_candidate";
      f.aliases.candidate.aliases = aliases;
    } else f.aliases.healthy.aliases = aliases;
    const api = async (path) => {
      const result = await f.api(path);
      baseline.aliases.splice(0, baseline.aliases.length, ...aliases.map((row) => row.alias));
      return result;
    };
    const readback = stage === "recovered" ? verifyApplicationRecovery(baseline, expected, api, f.runtime)
      : verifyApplicationTarget(expected, baseline, api, stage === "promoted", f.runtime);
    await expect(readback).rejects.toThrow(stage === "promoted" ? "RELEASE_PROMOTION_DRIFT" : "RELEASE_RECOVERY_DRIFT");
  });

  it.each(["baseline", "candidate", "recovered"])("rejects a Primary pointer changed during %s readback", async (stage) => {
    const f = fixture(), baseline = await captureApplicationBaseline(expected, f.api, f.runtime);
    const api = async (path) => {
      const result = await f.api(path);
      if (path.startsWith("/v2/deployments/dpl_healthy/aliases?")) f.owner.targets.production.id = "dpl_other";
      return result;
    };
    const readback = stage === "baseline" ? captureApplicationBaseline(expected, api, f.runtime)
      : stage === "recovered" ? verifyApplicationRecovery(baseline, expected, api, f.runtime)
        : verifyApplicationTarget(expected, baseline, api, false, f.runtime);
    await expect(readback).rejects.toThrow("RELEASE_PRIMARY_CHANGED");
  });

  it("rejects unavailable Primary owner metadata after baseline alias readback", async () => {
    const f = fixture();
    let aliasesRead = false;
    const api = async (path) => {
      if (aliasesRead && path.startsWith("/v9/projects/")) throw new Error("RELEASE_PROVIDER_READBACK_FAILED");
      const result = await f.api(path);
      if (path.startsWith("/v2/deployments/dpl_healthy/aliases?")) aliasesRead = true;
      return result;
    };
    await expect(captureApplicationBaseline(expected, api, f.runtime)).rejects.toThrow("RELEASE_PROVIDER_READBACK_FAILED");
  });

  it("rejects another recovery target or malformed candidate URL without provider access", async () => {
    const f = fixture(), baseline = await captureApplicationBaseline(expected, f.api, f.runtime);
    f.api.mockClear();
    await expect(verifyApplicationTarget({ ...expected, RELEASE_HEALTHY_DEPLOYMENT_ID: "dpl_other" }, baseline, f.api)).rejects.toThrow("RELEASE_BASELINE_DRIFT");
    await expect(verifyApplicationTarget({ ...expected, APPROVED_PRODUCTION_DEPLOYMENT: "https://candidate.vercel.app/evil" }, baseline, f.api)).rejects.toThrow("RELEASE_CANDIDATE_URL_INVALID");
    expect(f.api).not.toHaveBeenCalled();
  });

  it("requires valid recovery arguments and exact configured Primary identity", () => {
    expect(() => applicationPlanParameters({})).toThrow("RELEASE_RECOVERY_TARGET_REQUIRED");
    const env = { VERCEL_PROJECT_ID: project, VERCEL_ORG_ID: team, APP_BASE_URL: "https://app.qidaigo.com" };
    expect(() => assertApplicationPrimary(env)).not.toThrow();
    for (const key of Object.keys(env)) expect(() => assertApplicationPrimary({ ...env, [key]: "other" })).toThrow("RELEASE_PRIMARY_CONFIGURATION_DRIFT");
  });
});

it("reads canonical public runtime contracts without redirects or new session credentials", async () => {
  const request = vi.fn(async (url) => url.endsWith("/api/connectivity")
    ? new Response(null, { headers: { "x-service-state": "ready" } })
    : url.endsWith("/login") ? new Response("login")
      : new Response(JSON.stringify(url.endsWith("/api/version") ? { revision: beforeSha }
        : { mode: "NORMAL_PRIMARY", activeBackend: "PRIMARY", promotionEpoch: 3 }), { headers: { "content-type": "application/json" } }));
  const env = { VERCEL_AUTOMATION_BYPASS_SECRET: "fixture-bypass" };
  await expect(readApplicationRuntime("https://candidate.vercel.app", env, request)).resolves.toEqual({ connectivity: "ready", loginStatus: 200,
    version: { revision: beforeSha }, availability: { mode: "NORMAL_PRIMARY", activeBackend: "PRIMARY", promotionEpoch: 3 } });
  expect(request).toHaveBeenCalledTimes(4);
  for (const [, options] of request.mock.calls) {
    expect(options.redirect).toBe("error");
    expect(options.headers.cookie).toBeUndefined();
    expect(options.headers["x-vercel-protection-bypass"]).toBe("fixture-bypass");
  }
  request.mockRejectedValue(new Error("fixture-bypass private transport message"));
  await expect(readApplicationRuntime("https://candidate.vercel.app", env, request)).rejects.toThrow(/^RELEASE_RUNTIME_REQUEST_FAILED$/);
});

it("emits bound parameters through the real CLI and rejects legacy mode before provider access", () => {
  const cli = fileURLToPath(new URL("../production-application-target.mjs", import.meta.url));
  const run = (mode) => spawnSync(process.execPath, ["--max-old-space-size=64", cli, "parameters"], {
    encoding: "utf8", timeout: 5000,
    env: { SystemRoot: process.env.SystemRoot, ...expected, STALLORDER_RESILIENCE_MODE: mode, VERCEL_TOKEN: "fixture-private" },
  });
  const result = run("PRIMARY_ONLY");
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  const parameters = JSON.parse(result.stdout.trim().replace(/^PRODUCTION_APPROVAL_PARAMETERS_JSON=/u, ""));
  expect(parameters).toMatchObject({ resilienceMode: "PRIMARY_ONLY", primaryDeploymentId: "dpl_healthy", recoveryDeploymentId: "dpl_healthy" });
  const rejected = run("LEGACY_DR");
  expect(rejected.status).toBe(1);
  expect(rejected.stderr.trim()).toBe("RELEASE_RESILIENCE_MODE_REQUIRED");
  expect(result.stdout + rejected.stdout + rejected.stderr).not.toContain("fixture-private");
});

it.each(["succeeded", "failed", "missing", "read-error"])("writes a sanitized %s reconciliation receipt through the real CLI", async (state) => {
  const f = fixture(), baseline = await captureApplicationBaseline(expected, f.api, f.runtime);
  const candidate = await verifyApplicationTarget(expected, baseline, f.api, false, f.runtime);
  const root = resolve(import.meta.dirname, "../../test-results");
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(resolve(root, "promotion-cli-"));
  try {
    const input = resolve(directory, "candidate.json"), output = resolve(directory, "settled.json");
    writeFileSync(input, JSON.stringify(candidate), { flag: "wx" });
    const job = ["succeeded", "failed"].includes(state)
      ? { jobStatus: state, requestedAt: 1, toDeploymentId: "dpl_candidate", type: "promote" } : null;
    // Only the external fetch boundary is replaced; execute the actual CLI/file/exit path.
    const preload = `globalThis.fetch = async (url, options) => {
      if (options.redirect !== "error" || options.headers["cache-control"] !== "no-cache"
        || (options.method && options.method !== "GET")) throw new Error("unsafe request");
      if (url === ${JSON.stringify(`https://api.vercel.com/v13/deployments/dpl_candidate?teamId=${team}`)})
        return Response.json(${JSON.stringify(f.candidate)});
      if (url === ${JSON.stringify(`https://api.vercel.com/v9/projects/${project}?teamId=${team}`)}) {
        if (${JSON.stringify(state)} === "read-error") throw new Error("Bearer fixture-private");
        return Response.json(${JSON.stringify({ ...f.owner, lastAliasRequest: job })});
      }
      throw new Error("unexpected network request");
    };`;
    const cli = fileURLToPath(new URL("../production-application-target.mjs", import.meta.url));
    const result = spawnSync(process.execPath, ["--max-old-space-size=64", "--import",
      `data:text/javascript,${encodeURIComponent(preload)}`, cli, "settled", output, input], {
      encoding: "utf8", timeout: 5000, env: { SystemRoot: process.env.SystemRoot, ...expected,
        VERCEL_PROJECT_ID: project, VERCEL_ORG_ID: team, APP_BASE_URL: "https://app.qidaigo.com", VERCEL_TOKEN: "fixture-private" },
    });
    expect(result.error).toBeUndefined();
    const terminal = ["succeeded", "failed"].includes(state);
    expect(result.status).toBe(terminal ? 0 : 1);
    const text = readFileSync(output, "utf8");
    expect(JSON.parse(text)).toMatchObject({ status: terminal ? "PROMOTION_SETTLED" : "PROMOTION_UNKNOWN", safeToRecover: terminal });
    expect(text + result.stdout + result.stderr).not.toContain("fixture-private");
  } finally {
    if (!directory.startsWith(`${root}${sep}promotion-cli-`)) throw new Error("Unexpected fixture directory");
    rmSync(directory, { recursive: true });
  }
});

it("binds the recovery deployment and SHA to the immutable application Plan", () => {
  const createdAt = new Date("2026-10-12T09:00:00Z");
  const parameters = applicationPlanParameters(expected);
  expect(parameters).toMatchObject({ resilienceMode: "PRIMARY_ONLY", primaryDeploymentId: "dpl_healthy", primarySha: beforeSha });
  const receipt = createProductionApprovalReceipt({ repository: "KenLeeYa/Stallorder-Platform", planRunId: "123",
    commitSha: afterSha, treeSha: beforeSha, stagingTreeSha: beforeSha, operation: "production-application",
    parameters, requestedBy: "KenLeeYa", createdAt });
  const invocation = {
    receipt, now: new Date("2026-10-12T10:00:00Z"),
    expected: { repository: "KenLeeYa/Stallorder-Platform", planRunId: "123", commitSha: afterSha,
      treeSha: beforeSha, stagingTreeSha: beforeSha, operation: "production-application", parameters,
      repositoryOwner: "KenLeeYa", applyActor: "KenLeeYa" },
    runMetadata: { id: 123, path: ".github/workflows/production-application-release.yml", head_branch: "main",
      head_sha: afterSha, status: "completed", conclusion: "success", event: "workflow_dispatch",
      actor: { login: "KenLeeYa" }, created_at: createdAt.toISOString(), updated_at: "2026-10-12T09:01:00Z" },
  };
  expect(() => validateProductionApprovalReceipt(invocation)).not.toThrow();
  for (const changed of [{ ...parameters, recoverySha: "c".repeat(40) }, { ...parameters, recoveryDeploymentId: "dpl_other" },
    { ...parameters, primaryDeploymentId: "dpl_other" }, { ...parameters, primarySha: "c".repeat(40) },
    { ...parameters, resilienceMode: "LEGACY_DR" }]) {
    expect(() => validateProductionApprovalReceipt({ ...invocation, expected: { ...invocation.expected, parameters: changed } })).toThrow();
  }
});

it("refuses unsafe runtime origins, redirects and denied public probes without retry", async () => {
  const request = vi.fn();
  const env = {};
  for (const origin of ["http://candidate.vercel.app", "https://candidate.vercel.app.evil.test", "https://candidate.vercel.app/path", "https://user@candidate.vercel.app", "https://dr.qidaigo.com"]) {
    await expect(readApplicationRuntime(origin, env, request)).rejects.toThrow("RELEASE_RUNTIME_ORIGIN_INVALID");
  }

  expect(request).not.toHaveBeenCalled();
  for (const status of [302, 401, 403, 500]) {
    request.mockReset().mockResolvedValue(new Response("private error body", { status }));
    await expect(readApplicationRuntime("https://candidate.vercel.app", env, request)).rejects.toThrow(/^RELEASE_RUNTIME_REQUEST_FAILED$/);
    expect(request).toHaveBeenCalledOnce();
  }
});

for (const change of ["third-party", "changed-job", "active-job", "wrong-source", "epoch", "read-failure", "alias-moved", "alias-added", "old-alias-remains"]) {
  it(`refuses recovery admission after ${change} drift without another provider write`, async () => {
    const f = fixture(), baseline = await captureApplicationBaseline(expected, f.api, f.runtime);
    f.owner.lastAliasRequest = { ...recoveryAdmission.observations[0] };
    f.owner.targets.production.id = "dpl_candidate";
    f.aliases.healthy.aliases = []; f.aliases.candidate.aliases = [{ alias: "app.qidaigo.com" }];
    if (change === "alias-moved") f.aliases.candidate.aliases = [];
    if (change === "alias-added") f.aliases.candidate.aliases.push({ alias: "unexpected.example.com" });
    if (change === "old-alias-remains") f.aliases.healthy.aliases = [{ alias: "app.qidaigo.com" }];
    if (change === "third-party") f.owner.targets.production.id = "dpl_other";
    if (change === "changed-job") f.owner.lastAliasRequest.requestedAt++;
    if (change === "active-job") f.owner.lastAliasRequest.jobStatus = "pending";
    if (change === "wrong-source") f.healthy.meta.git_commit = "c".repeat(40);
    if (change === "epoch") f.runtime.mockResolvedValue({ connectivity: "ready", loginStatus: 200,
      version: { revision: beforeSha }, availability: { mode: "NORMAL_PRIMARY", activeBackend: "PRIMARY", promotionEpoch: 4 } });
    if (change === "read-failure") f.api.mockRejectedValue(new Error("read failed"));
    await expect(verifyApplicationRecoveryAdmission(baseline, expected, f.api, f.runtime, recoveryAdmission)).rejects.toThrow();
  });
}
it("admits one exact recovery after its identified terminal candidate operation", async () => {
  const f = fixture(), baseline = await captureApplicationBaseline(expected, f.api, f.runtime);
  f.owner.lastAliasRequest = { ...recoveryAdmission.observations[0] };
  f.owner.targets.production.id = "dpl_candidate";
  f.aliases.healthy.aliases = []; f.aliases.candidate.aliases = [{ alias: "app.qidaigo.com" }];
  await expect(verifyApplicationRecoveryAdmission(baseline, expected, f.api, f.runtime, recoveryAdmission))
    .resolves.toEqual({ status: "RECOVERY_ADMITTED", deploymentId: "dpl_healthy", sha: beforeSha });
});

it("refuses a new provider operation appearing during the final recovery alias read", async () => {
  const f = fixture(), baseline = await captureApplicationBaseline(expected, f.api, f.runtime);
  f.owner.lastAliasRequest = { ...recoveryAdmission.observations[0] };
  f.owner.targets.production.id = "dpl_candidate";
  f.aliases.healthy.aliases = []; f.aliases.candidate.aliases = [{ alias: "app.qidaigo.com" }];
  let oldAliasReads = 0;
  const api = async path => {
    const result = await f.api(path);
    if (path.startsWith("/v2/deployments/dpl_healthy/aliases?") && ++oldAliasReads === 3)
      f.owner.lastAliasRequest = { jobStatus: "pending", requestedAt: 2, type: "promote", toDeploymentId: "dpl_other" };
    return result;
  };
  await expect(verifyApplicationRecoveryAdmission(baseline, expected, api, f.runtime, recoveryAdmission))
    .rejects.toThrow("RELEASE_RECOVERY_JOB_UNPROVEN");
});
