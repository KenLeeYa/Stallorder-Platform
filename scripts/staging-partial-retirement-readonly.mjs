// Protected diagnostic only. A matching observation cannot authorize continuation.
import { isDeepStrictEqual } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { conversionRequired } from "./dr-staging-conversion-plan.mjs";
import { compareOriginalPartialProofData } from "./staging-partial-retirement-backup.mjs";
import { readCurrentPartialSources } from "./staging-partial-retirement-sources.mjs";
import { readCurrentPartialEntry } from "./staging-partial-retirement-entry.mjs";
import { readCurrentPartialIsolation } from "./staging-partial-retirement-isolation.mjs";
import { readCurrentPartialSecurity } from "./staging-partial-retirement-security.mjs";

const repository = "KenLeeYa/Stallorder-Platform";
const workflow = ".github/workflows/dr-staging-partial-proof.yml";
const denied = { diagnosticOnly: true, planQualified: false, remainingDataProven: false, remainingSchemaProven: false };
function requireProof(condition) { if (!condition) throw new Error("STAGING_PARTIAL_READONLY_FAILED"); }

async function github(path) {
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, { method: "GET", redirect: "error",
    headers: { authorization: `Bearer ${conversionRequired("GITHUB_TOKEN")}`, accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(60_000) });
  requireProof(response.status === 200);
  const bytes = await boundedBytes(response, 2 * 1024 * 1024);
  return JSON.parse(bytes.toString("utf8"));
}

async function boundedBytes(response, limit) {
  requireProof(response.body);
  const parts = []; let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length; requireProof(length <= limit); parts.push(Buffer.from(chunk));
  }
  return Buffer.concat(parts);
}

async function archive(runId, artifactId, size, digest) {
  const run = await github(`/actions/runs/${runId}`);
  const artifact = await github(`/actions/artifacts/${artifactId}`);
  let response = await fetch(`https://api.github.com/repos/${repository}/actions/artifacts/${artifactId}/zip`, {
    method: "GET", redirect: "manual", headers: { authorization: `Bearer ${conversionRequired("GITHUB_TOKEN")}` },
    signal: AbortSignal.timeout(60_000) });
  if (response.status === 302) {
    const url = new URL(response.headers.get("location"));
    requireProof(url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash
      && (url.hostname.endsWith(".blob.core.windows.net") || url.hostname.endsWith(".actions.githubusercontent.com")));
    // The signed archive URL is private. Never forward the GitHub token, allow
    // another redirect, log this URL, or trust its bytes without pinned hashes.
    response = await fetch(url.href, { method: "GET", redirect: "error", signal: AbortSignal.timeout(60_000) });
  }
  requireProof(response.status === 200);
  const zip = await boundedBytes(response, size); requireProof(zip.length === size);
  requireProof(createHash("sha256").update(zip).digest("hex") === digest);
  return { run, artifact, zip };
}

async function invocation() {
  const env = process.env;
  requireProof(env.GITHUB_ACTIONS === "true" && env.GITHUB_REPOSITORY === repository
    && env.GITHUB_ACTOR === "KenLeeYa" && env.GITHUB_TRIGGERING_ACTOR === "KenLeeYa"
    && env.GITHUB_REF === "refs/heads/main" && env.GITHUB_REF_PROTECTED === "true"
    && /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "") && env.GITHUB_WORKFLOW_SHA === env.GITHUB_SHA
    && env.GITHUB_WORKFLOW_REF === `${repository}/${workflow}@refs/heads/main`
    && env.GITHUB_EVENT_NAME === "workflow_dispatch" && env.GITHUB_RUN_ATTEMPT === "1"
    && /^[1-9][0-9]{0,14}$/.test(env.GITHUB_RUN_ID ?? "")
    && env.GITHUB_JOB === "readonly-proof" && env.RUNNER_OS === "Linux");
  const run = await github(`/actions/runs/${env.GITHUB_RUN_ID}`);
  requireProof(run?.id === Number(env.GITHUB_RUN_ID) && run.run_attempt === 1 && run.head_sha === env.GITHUB_SHA
    && run.head_branch === "main" && run.path === workflow && run.event === "workflow_dispatch"
    && run.status === "in_progress" && run.conclusion === null && run.actor?.login === "KenLeeYa"
    && run.triggering_actor?.login === "KenLeeYa" && run.repository?.full_name === repository
    && run.repository.owner?.login === "KenLeeYa" && run.head_repository?.full_name === repository);
}

export async function runProtectedPartialReadOnly() {
  let phase = "invocation";
  try {
    await invocation();
    phase = "archives";
    const backup = await archive(39647447270, 12368487539, 9441387, "fbab2a1c9b481c60ad4e8d67442c1842055ec72ba0f12d09c18f34ee324f5cd9");
    const apply = await archive(39944614570, 12497707244, 20984, "6e453c336b9437d2e74bb9e14cc2c38029ebf2364617eb8dbacc3406c367e304");
    const plan = await archive(39944190461, 12497002610, 2508, "252c10206aff140cf3d27cb0d1a4139929d7efc5c87f44b4230ffdc7341977e7");
    const retirement = { applyRun: apply.run, applyArtifact: apply.artifact, applyZip: apply.zip,
      planRun: plan.run, planArtifact: plan.artifact, planZip: plan.zip, fileCount: 42,
      backup: { runId: "39647447270", commit: "291c3c56f1dc6ed743f9c7fe67a117f2dac554ff",
        artifactId: 12368487539, artifactDigest: "sha256:fbab2a1c9b481c60ad4e8d67442c1842055ec72ba0f12d09c18f34ee324f5cd9" } };
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
    return summarizePartialReadOnlyObservations({ sources, entry, isolation, security },
      { sources: afterSources, entry: afterEntry, isolation: afterIsolation, security: afterSecurity }, compared);
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
  const receipt = await runProtectedPartialReadOnly();
  // Only this allowlisted result is persisted. Never write private provider data,
  // decrypted rows, dump bytes, catalog bodies or the raw caught exception.
  await mkdir("artifacts/partial-proof-public", { recursive: true });
  await writeFile("artifacts/partial-proof-public/receipt.json", `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt));
  if (receipt.status !== "observed") process.exitCode = 1;
}
