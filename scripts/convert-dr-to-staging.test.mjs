import { describe, expect, it } from "vitest";
import { assertStagingDatabaseTarget, assertRestorationEvidence, assertPrimaryIsolation, executeStagingCleanup } from "./convert-dr-to-staging.mjs";

describe("DR retirement destructive boundary", () => {
  it("stops before deletion on drift and rechecks Primary between each mutation", async () => {
    const calls = [];
    const ops = Object.fromEntries(["verifyPlan", "verifyPrimary", "verifyOriginalData", "verifyProtectedEntry",
      "isolateProviders", "deleteBackedUpFiles", "clearOldCredentials", "resetAndSeed", "verifySynthetic"]
      .map((name) => [name, async () => { calls.push(name); }]));
    await executeStagingCleanup({}, ops);
    expect(calls).toEqual(["verifyPlan", "verifyPrimary", "verifyOriginalData", "verifyProtectedEntry",
      "isolateProviders", "verifyPrimary", "deleteBackedUpFiles", "verifyPrimary",
      "clearOldCredentials", "verifyPrimary", "resetAndSeed", "verifyPrimary", "verifySynthetic"]);
    calls.length = 0;
    await expect(executeStagingCleanup({}, { ...ops, verifyOriginalData: async () => { throw new Error("DRIFT"); } })).rejects.toThrow("DRIFT");
    expect(calls).toEqual(["verifyPlan", "verifyPrimary"]);
    calls.length = 0;
    await expect(executeStagingCleanup({}, { ...ops, deleteBackedUpFiles: async () => { throw new Error("DELETE_FAILED"); } })).rejects.toThrow("DELETE_FAILED");
    expect(calls).not.toContain("resetAndSeed");
  });
  it("rejects Primary and every connection-string target override", () => {
    const url = "postgresql://postgres.daeqwtpaxcebmtwxqdkj:example-placeholder@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require&connect_timeout=10";
    expect(() => assertStagingDatabaseTarget(url)).not.toThrow();
    for (const invalid of [url.replace("daeqwtpaxcebmtwxqdkj", "eyuctbnlvnbnivwasvqr"),
      `${url}&host=evil.example`, `${url}&options=-c%20role=other`, url.replace("require", "disable"),
      url.replace(":5432/", ":6543/")]) {
      expect(() => assertStagingDatabaseTarget(invalid)).toThrow("STAGING_DATABASE_TARGET_INVALID");
    }
  });

  it("requires actual restored paths, file readback and a successful reset rehearsal", () => {
    const identity = { runId: "12345", commit: "a".repeat(40) };
    const manifest = { ...identity, version: 3, ref: "daeqwtpaxcebmtwxqdkj", tables: [{}], files: [{}] };
    const proof = { ...identity, ref: manifest.ref, encrypted: true, databaseDataRestore: true,
      restoredOriginalObjectPaths: true, restoredFileReadback: true, restoredFileBytes: true,
      primaryWrites: false, remoteWrites: false, tableCount: 1, fileCount: 1 };
    const rehearsal = { runId: identity.runId, sourceSha: identity.commit, remoteWrites: false,
      hostedCleanup: false, exactCliRemoteResetPath: true, sequenceRegression: true,
      applicationRole: "postgres", syntheticSafetyOverlay: true,
      syntheticState: { real_orders: 0, organizations: 2, vault: 0, auth_users: 0,
        files: 0, subscriptions: 0, active_crons: 0, migrations: 146, enabled_printers: 0, enabled_non_cash: 0 } };
    expect(() => assertRestorationEvidence(proof, manifest, rehearsal, identity, 146)).not.toThrow();
    for (const changed of [{ ...proof, restoredFileReadback: false }, { ...proof, primaryWrites: true },
      { ...proof, runId: "999" }, { ...proof, fileCount: 2 }]) {
      expect(() => assertRestorationEvidence(changed, manifest, rehearsal, identity, 146))
        .toThrow("STAGING_RESTORE_PROOF_INVALID");
    }
    expect(() => assertRestorationEvidence(proof, manifest,
      { ...rehearsal, syntheticState: { ...rehearsal.syntheticState, active_crons: 1 } }, identity, 146))
      .toThrow("STAGING_REHEARSAL_PROOF_INVALID");
  });

  it("requires the live Primary-only artifact and no Production DR bindings", () => {
    const state = {
      deployment: { id: "dpl_test", projectId: "prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP", target: "production",
        readyState: "READY", meta: { git_commit: "b".repeat(40), dr_runtime_retired: "true" } },
      alias: { projectId: "prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP", deploymentId: "dpl_test" },
      environment: { envs: [] }, version: { revision: "b".repeat(40) },
      availability: { mode: "NORMAL_PRIMARY", activeBackend: "PRIMARY", promotionEpoch: 3 },
    };
    expect(() => assertPrimaryIsolation(state)).not.toThrow();
    for (const changed of [
      { ...state, deployment: { ...state.deployment, meta: { ...state.deployment.meta, dr_runtime_retired: "false" } } },
      { ...state, environment: { envs: [{ key: "DR_DATABASE_URL", target: ["production"] }] } },
      { ...state, version: { revision: "c".repeat(40) } },
      { ...state, alias: { ...state.alias, deploymentId: "different" } },
    ]) expect(() => assertPrimaryIsolation(changed)).toThrow("STAGING_PRIMARY_NOT_ISOLATED");
  });
});
