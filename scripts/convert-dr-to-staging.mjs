import assert from "node:assert/strict";

const DR_REF = "daeqwtpaxcebmtwxqdkj";
const PRIMARY_PROJECT = "prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP";

// These preconditions are not an Apply entry point. A protected workflow must
// bind them to its fresh provider snapshot and immutable Plan before any write.
export async function executeStagingCleanup(plan, operations) {
  await operations.verifyPlan(plan);
  await operations.verifyPrimary(plan);
  await operations.verifyOriginalData(plan);
  await operations.verifyProtectedEntry(plan);
  for (const step of ["isolateProviders", "deleteBackedUpFiles", "clearOldCredentials", "resetAndSeed"]) {
    await operations[step](plan);
    await operations.verifyPrimary(plan);
  }
  await operations.verifySynthetic(plan);
}

export function assertStagingDatabaseTarget(value) {
  const url = new URL(value);
  assert.ok(url.protocol === "postgresql:"
    && url.hostname === "aws-0-ap-northeast-1.pooler.supabase.com"
    && decodeURIComponent(url.username) === `postgres.${DR_REF}`
    && url.port === "5432" && url.pathname === "/postgres" && !url.hash
    && url.searchParams.get("sslmode") === "require"
    && [...url.searchParams.keys()].every((key) => ["sslmode", "connect_timeout"].includes(key))
    && url.searchParams.getAll("sslmode").length === 1,
  "STAGING_DATABASE_TARGET_INVALID");
  return url;
}

export function assertRestorationEvidence(proof, manifest, rehearsal, identity, migrationCount) {
  assert.ok(/^[1-9][0-9]+$/.test(identity.runId) && /^[a-f0-9]{40}$/.test(identity.commit)
    && [manifest, proof].every((item) => item.runId === identity.runId
      && item.commit === identity.commit && item.ref === DR_REF)
    && manifest.version === 3 && proof.encrypted === true && proof.databaseDataRestore === true
    && proof.restoredOriginalObjectPaths === true && proof.restoredFileReadback === true
    && proof.restoredFileBytes === true && proof.primaryWrites === false && proof.remoteWrites === false
    && Array.isArray(manifest.tables) && manifest.tables.length > 0
    && proof.tableCount === manifest.tables.length && Array.isArray(manifest.files)
    && proof.fileCount === manifest.files.length,
  "STAGING_RESTORE_PROOF_INVALID");
  const state = rehearsal?.syntheticState;
  assert.ok(rehearsal?.runId === identity.runId && rehearsal.sourceSha === identity.commit
    && rehearsal.remoteWrites === false && rehearsal.hostedCleanup === false
    && rehearsal.sequenceRegression === true && rehearsal.applicationRole === "postgres" && rehearsal.syntheticSafetyOverlay === true
    && rehearsal.exactCliRemoteResetPath === true && state?.organizations === 2
    && state.real_orders === 0 && state.vault === 0 && state.auth_users === 0
    && state.files === 0 && state.subscriptions === 0 && state.active_crons === 0
    && state.enabled_printers === 0 && state.enabled_non_cash === 0
    && Number.isSafeInteger(migrationCount) && migrationCount > 0 && state.migrations === migrationCount,
  "STAGING_REHEARSAL_PROOF_INVALID");
}

export function assertPrimaryIsolation({ deployment, alias, environment, version, availability }) {
  assert.ok(deployment.projectId === PRIMARY_PROJECT && deployment.target === "production"
    && deployment.readyState === "READY" && deployment.meta?.dr_runtime_retired === "true"
    && alias.projectId === PRIMARY_PROJECT && alias.deploymentId === deployment.id
    && /^[a-f0-9]{40}$/.test(version.revision) && version.revision === deployment.meta.git_commit
    && availability.mode === "NORMAL_PRIMARY" && availability.activeBackend === "PRIMARY"
    && Number.isSafeInteger(availability.promotionEpoch)
    && Array.isArray(environment.envs) && !environment.pagination?.next
    && !environment.envs.some((entry) => entry.key?.startsWith("DR_") && entry.target?.includes("production")),
  "STAGING_PRIMARY_NOT_ISOLATED");
}
