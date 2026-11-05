// Protected diagnostic only. A matching observation cannot authorize continuation.
import { isDeepStrictEqual } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { conversionRequired } from "./dr-staging-conversion-plan.mjs";
import { compareOriginalPartialProofData } from "./staging-partial-retirement-backup.mjs";
import { readCurrentPartialSources } from "./staging-partial-retirement-sources.mjs";
import { readCurrentPartialEntry } from "./staging-partial-retirement-entry.mjs";
import { readCurrentPartialIsolation } from "./staging-partial-retirement-isolation.mjs";
import { readCurrentPartialSecurity } from "./staging-partial-retirement-security.mjs";
import { readPartialProofArchive as archive, assertPartialProofInvocation as invocation } from "./staging-partial-retirement-transport.mjs";
import { readProtectedPlanHistoryInputs } from "./staging-plan-history.mjs";

const denied = { diagnosticOnly: true, planQualified: false, remainingDataProven: false, remainingSchemaProven: false };
function requireProof(condition) { if (!condition) throw new Error("STAGING_PARTIAL_READONLY_FAILED"); }

// Preserve the existing transport API without a history/consumer import cycle.
export { readPartialProofGithub, readPartialProofArchive, assertPartialProofInvocation } from "./staging-partial-retirement-transport.mjs";

export async function runProtectedPartialReadOnly(options = { mode: "current-artifact" }) {
  let phase = "mode";
  try {
    requireProof(options && Object.keys(options).length === 1
      && ["current-artifact", "consumed-plan-history-v1"].includes(options.mode));
    phase = "invocation";
    await invocation();
    phase = "archives";
    let backup, retirement, history;
    if (options.mode === "consumed-plan-history-v1") {
      ({ backup, retirement, summary: history } = await readProtectedPlanHistoryInputs(options));
    } else {
      backup = await archive(39647447270, 12368487539, 9441387, "fbab2a1c9b481c60ad4e8d67442c1842055ec72ba0f12d09c18f34ee324f5cd9");
      const apply = await archive(39944614570, 12497707244, 20984, "6e453c336b9437d2e74bb9e14cc2c38029ebf2364617eb8dbacc3406c367e304");
      const plan = await archive(39944190461, 12497002610, 2508, "252c10206aff140cf3d27cb0d1a4139929d7efc5c87f44b4230ffdc7341977e7");
      retirement = { applyRun: apply.run, applyArtifact: apply.artifact, applyZip: apply.zip,
        planRun: plan.run, planArtifact: plan.artifact, planZip: plan.zip, fileCount: 42,
        backup: { runId: "39647447270", commit: "291c3c56f1dc6ed743f9c7fe67a117f2dac554ff",
          artifactId: 12368487539, artifactDigest: "sha256:fbab2a1c9b481c60ad4e8d67442c1842055ec72ba0f12d09c18f34ee324f5cd9" } };
    }
    phase = "current-safety";
    requireProof(execFileSync("git", ["diff", "--exit-code", "291c3c56f1dc6ed743f9c7fe67a117f2dac554ff", "HEAD", "--",
      "supabase/migrations", "supabase/seed.sql", "scripts/rehearse-dr-staging-reset.mjs", "scripts/lib/dr-reset-preparation.mjs"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => ["PATH", "SYSTEMROOT"].includes(key.toUpperCase()))) }).trim() === "");
    const sources = await readCurrentPartialSources();
    const entry = await readCurrentPartialEntry(retirement);
    const isolation = await readCurrentPartialIsolation();
    const security = await readCurrentPartialSecurity();
    phase = "authenticated-restore-replay-compare";
    const compared = await compareOriginalPartialProofData({ backup: { ...backup,
      key: conversionRequired("DR_BACKUP_ENCRYPTION_KEY") }, retirement,
      containerId: conversionRequired("PARTIAL_PROOF_CONTAINER") });
    phase = "final-readback";
    const afterSources = await readCurrentPartialSources();
    const afterEntry = await readCurrentPartialEntry(retirement);
    const afterIsolation = await readCurrentPartialIsolation();
    const afterSecurity = await readCurrentPartialSecurity();
    await invocation();
    const receipt = summarizePartialReadOnlyObservations({ sources, entry, isolation, security },
      { sources: afterSources, entry: afterEntry, isolation: afterIsolation, security: afterSecurity }, compared);
    // Enumerate historical fields too: never spread the private adapter bundle
    // or its backupDecrypted=false historical-only observation into full proof.
    if (history) {
      requireProof(history.historicalProvenanceValidated === true && history.originalPlanConsumed === true
        && history.originalApprovalExpired === true && history.applyAuthorized === false);
      return { ...receipt, evidenceMode: options.mode, historicalProvenanceValidated: true,
        originalPlanConsumed: true, originalApprovalExpired: true, originalArtifactAvailabilityClaimed: false,
        applyAuthorized: false, remoteWrites: false };
    }
    return receipt;
  } catch {
    return { ...denied, status: "failed", phase, error: "STAGING_PARTIAL_READONLY_FAILED" };
  }
}

// Pure diagnostic receipt policy, not provenance or a protected entry. Only
// runProtectedPartialReadOnly obtains authenticated observations and writes it.
export function summarizePartialReadOnlyObservations(before, after, compared) {
  const { sources, entry, isolation, security } = before ?? {};
  for (const observation of [before, after]) {
    requireProof(observation && ["sources", "entry", "isolation", "security"].every(name =>
      observation[name]?.diagnosticOnly === true && observation[name].planQualified === false));
    requireProof(observation.sources.currentSourcesMatched === true && observation.sources.mainRemoteReadinessPassed === true
      && observation.sources.stagingRemoteReadinessClaimed === false
      && ["sourceSha", "stagingSha", "tree"].every(key => /^[a-f0-9]{40}$/.test(observation.sources[key] ?? ""))
      && observation.entry.currentEntryConfigurationMatched === true && observation.entry.oldQaTokenAbsent === true
      && observation.entry.oldQaPolicyAbsent === true && observation.entry.primaryBaselineMatched === true
      && observation.isolation.currentDatabaseIsolationObserved === true && observation.isolation.currentAuthIsolationObserved === true
      && observation.isolation.knownEdgeSettingsMatched === true && observation.security.currentGlobalSecurityCaptured === true);
    for (const [reader, field] of [["entry", "privateCurrentEntry"], ["isolation", "privateIsolation"], ["security", "privateGlobalSecurity"]]) {
      requireProof(observation[reader][field] && typeof observation[reader][field] === "object" && !Array.isArray(observation[reader][field]));
    }
  }
  requireProof(isDeepStrictEqual(sources, after.sources)
    && isDeepStrictEqual(entry.privateCurrentEntry, after.entry.privateCurrentEntry)
    && isDeepStrictEqual(isolation.privateIsolation, after.isolation.privateIsolation)
    && isDeepStrictEqual(security.privateGlobalSecurity, after.security.privateGlobalSecurity));
  requireProof(compared?.originalFingerprintsVerified === true && compared.offlineMetadataReplay === true
    && compared.remainingTableDataMatched === true && compared.remainingCatalogMatched === true
    && compared.sequenceStateMatched === true && compared.rowCatalogSingleStatement === true
    && compared.sequenceSnapshotAtomic === false && compared.remainingDataProven === false
    && compared.remainingSchemaProven === false && compared.planQualified === false);
  // Enumerate the public fields: new private adapter fields must never become
  // artifact or console output. A matching diagnostic grants no continuation.
  return { ...denied, status: "observed", sourceSha: sources.sourceSha, stagingSha: sources.stagingSha,
    tree: sources.tree, failedApplyRunId: "39944614570", consumedPlanRunId: "39944190461", backupRunId: "39647447270",
    originalFingerprintsVerified: true, offlineMetadataReplay: true, remainingTableDataMatched: true,
    remainingCatalogMatched: true, sequenceStateMatched: true, rowCatalogSingleStatement: true,
    currentSourcesMatched: true, mainRemoteReadinessPassed: true, stagingRemoteReadinessClaimed: false,
    currentEntryConfigurationMatched: true, oldQaTokenAbsent: true, oldQaPolicyAbsent: true,
    primaryBaselineMatched: true, currentDatabaseIsolationObserved: true, currentAuthIsolationObserved: true,
    knownEdgeSettingsMatched: true, currentGlobalSecurityCaptured: true, finalReadbackMatched: true,
    sequenceSnapshotAtomic: false, sequenceWriterQuiescenceProven: false, historicalGlobalStateProven: false,
    currentGlobalSafetyProven: false, independentEdgeCredentialsProven: false,
    humanAccessAcceptanceProven: false, runtimeAcceptanceProven: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const receipt = await runProtectedPartialReadOnly({ mode: process.env.PARTIAL_PROOF_EVIDENCE_MODE ?? "current-artifact" });
  // Only this allowlisted result is persisted. Never write private provider data,
  // decrypted rows, dump bytes, catalog bodies or the raw caught exception.
  await mkdir("artifacts/partial-proof-public", { recursive: true });
  await writeFile("artifacts/partial-proof-public/receipt.json", `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt));
  if (receipt.status !== "observed") process.exitCode = 1;
}
