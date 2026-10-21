import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { executeStagingCleanup } from "./convert-dr-to-staging.mjs";
import { conversionDigest, requireConversionInvocation, readConversionBackup, readApprovedConversionPlan,
  readConversionPrimary, readStagingProviderPrestate, verifyOriginalReplica, verifyConversionSourceChecks } from "./dr-staging-conversion-plan.mjs";
import { prepareStagingAccess, readStagingAccess, removeStagingQaAccess } from "./staging-access-entry.mjs";
import { isolateStagingProviders, removeBackedUpStorage, clearRetiredDrCredentials, resetAndSeedStaging, verifySyntheticStaging } from "./staging-data-conversion.mjs";
import { deployStagingRuntime, verifyStagingEntryTls } from "./staging-runtime.mjs";
import { acceptStaging } from "./staging-acceptance.mjs";
import { detachRetiredEntries, retireOldCloudflareEntry } from "./staging-retired-entry.mjs";

let plan;
const completed = [];
async function checkpoint(name) {
  completed.push(name);
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/staging-conversion-progress.json", JSON.stringify({
    sourceSha: plan.sourceSha, planDigest: conversionDigest(plan), completed, primaryWrites: false,
  }, null, 2));
  console.log(`PASS: ${name}`);
}
try {
  requireConversionInvocation();
  assert.equal(process.env.STAGING_CONVERSION_CONFIRMATION, "CONVERT_RETIRED_DR_TO_STAGING", "STAGING_CONFIRMATION_INVALID");
  const backup = await readConversionBackup();
  plan = await readApprovedConversionPlan(backup);
  const verifyPrimary = async () => assert.deepEqual(await readConversionPrimary(), plan.primary, "STAGING_PRIMARY_CHANGED");
  const step = (name, action) => async () => { await action(); await checkpoint(name); };
  await executeStagingCleanup(plan, {
    verifyPlan: step("immutable-plan", async () => {
      const verified = spawnSync(process.execPath, ["scripts/production-approval.mjs", "verify"], { encoding: "utf8", env: process.env });
      assert.equal(verified.status, 0, "STAGING_IMMUTABLE_PLAN_NOT_VERIFIED");
      assert.deepEqual(await verifyConversionSourceChecks(), plan.sourceChecks, "STAGING_SOURCE_CHECKS_CHANGED");
      assert.deepEqual(await readStagingProviderPrestate(), plan.providerPrestate, "STAGING_PROVIDER_PRESTATE_CHANGED");
    }),
    verifyPrimary,
    verifyOriginalData: step("original-data-matches-qualified-backup", async () => {
      assert.equal(await verifyOriginalReplica(backup.manifest), plan.replicaDigest, "STAGING_REPLICA_CHANGED");
    }),
    verifyProtectedEntry: step("protected-entry-and-token-edit-permissions", async () => {
      await prepareStagingAccess(plan, verifyPrimary);
      await readStagingAccess(plan);
      await detachRetiredEntries(plan, verifyPrimary);
    }),
    isolateProviders: step("independent-provider-credentials", () => isolateStagingProviders(plan)),
    deleteBackedUpFiles: step("old-files-deleted-with-readback", () => removeBackedUpStorage(backup.manifest, verifyPrimary)),
    clearOldCredentials: step("old-vault-and-private-schemas-retired", clearRetiredDrCredentials),
    resetAndSeed: step("hosted-reset-migrations-database-tests-and-synthetic-seed", resetAndSeedStaging),
    verifySynthetic: step("synthetic-only-isolation", () => verifySyntheticStaging(plan)),
  });
  await deployStagingRuntime(plan, verifyPrimary);
  await checkpoint("preview-runtime-deployed");
  await verifyStagingEntryTls(plan, verifyPrimary);
  await checkpoint("origin-jwt-and-tls-verified");
  await acceptStaging(plan, verifyPrimary);
  await checkpoint("automated-staging-acceptance");
  await retireOldCloudflareEntry(plan, verifyPrimary);
  await checkpoint("old-dr-dns-and-access-retired");
} catch (error) {
  console.error(/^STAGING_[A-Z0-9_]+$/.test(error?.message ?? "") ? error.message : "STAGING_CONVERSION_FAILED");
  process.exitCode = 1;
} finally {
  if (plan) {
    await removeStagingQaAccess(plan).catch((error) => {
      if (error.code === "ENOENT") return;
      console.error("STAGING_TEMPORARY_ACCESS_CLEANUP_FAILED");
      process.exitCode = 1;
    });
  }
}
