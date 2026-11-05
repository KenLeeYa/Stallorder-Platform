// Explicit protected historical transport. Never a fallback or a new approval.
import { createHash } from "node:crypto";
import { readFailedRetirementEvidence, assertRetirementRunIdentity } from "./staging-partial-retirement-proof.mjs";
import { assertOriginalPartialProofArchive } from "./staging-partial-retirement-backup.mjs";
import { assertPartialProofInvocation, readPartialProofGithub,
  readPartialProofArchive } from "./staging-partial-retirement-transport.mjs";

const repository = "KenLeeYa/Stallorder-Platform";
const source = "32e9de2cf325240679c1a56f336b4c0f8c9d6664";
const workflow = ".github/workflows/dr-staging-conversion.yml";
const planHash = "252c10206aff140cf3d27cb0d1a4139929d7efc5c87f44b4230ffdc7341977e7";
const backup = Object.freeze({ runId: "39647447270", commit: "291c3c56f1dc6ed743f9c7fe67a117f2dac554ff",
  artifactId: 12368487539, artifactDigest: "sha256:fbab2a1c9b481c60ad4e8d67442c1842055ec72ba0f12d09c18f34ee324f5cd9" });
function requireHistory(condition) { if (!condition) throw new Error("STAGING_PLAN_HISTORY_FAILED"); }

function validateOriginalRuns(planRun, applyRun) {
  assertRetirementRunIdentity(planRun, "39944190461", "success");
  assertRetirementRunIdentity(applyRun, "39944614570", "failure");
  for (const run of [planRun, applyRun]) requireHistory(run?.repository?.id === 1298874780
    && run.repository.full_name === repository && run.head_repository?.id === 1298874780
    && run.head_repository.full_name === repository);
}

export function decodeConsumedPlanZip(encoded) {
  requireHistory(typeof encoded === "string" && encoded.length === 3344 && /^[A-Za-z0-9+/]+$/.test(encoded));
  const zip = Buffer.from(encoded, "base64");
  requireHistory(zip.length === 2508 && zip.toString("base64") === encoded
    && createHash("sha256").update(zip).digest("hex") === planHash);
  return zip;
}

export { validateConsumedRetirementHistory } from "./staging-partial-retirement-proof.mjs";

// PRIVATE raw inputs for the complete readonly proof only. Never persist, log,
// upload or treat this bundle as a replacement artifact or executable Plan.
export async function readProtectedPlanHistoryInputs(options) {
  try {
    requireHistory(options && Object.keys(options).length === 1 && options.mode === "consumed-plan-history-v1");
    await assertPartialProofInvocation();
    const planZip = decodeConsumedPlanZip(process.env.DR_STAGING_CONSUMED_PLAN_39944190461_ZIP_BASE64);
    const planRun = await readPartialProofGithub("/actions/runs/39944190461");
    const apply = await readPartialProofArchive(39944614570, 12497707244, 20984,
      "6e453c336b9437d2e74bb9e14cc2c38029ebf2364617eb8dbacc3406c367e304");
    validateOriginalRuns(planRun, apply.run);
    const original = await readPartialProofArchive(39647447270, 12368487539, 9441387,
      "fbab2a1c9b481c60ad4e8d67442c1842055ec72ba0f12d09c18f34ee324f5cd9");
    assertOriginalPartialProofArchive(original);
    const applyJob = await readPartialProofGithub("/actions/jobs/120384090004");
    const workflowDocument = await readPartialProofGithub(`/contents/${workflow}?ref=${source}`);
    const retirement = { mode: options.mode, applyRun: apply.run, applyArtifact: apply.artifact, applyZip: apply.zip,
      planRun, planZip, applyJob, workflowDocument, backup, fileCount: 42 };
    const summary = readFailedRetirementEvidence(retirement);
    await assertPartialProofInvocation();
    return { retirement, backup: original, summary: { ...summary, historicalProvenanceValidated: true,
      transport: "protected-original-zip-base64", originalArtifactAvailabilityClaimed: false, backupDecrypted: false } };
  } catch { throw new Error("STAGING_PLAN_HISTORY_FAILED"); }
}

// Public historical-only adapter keeps its strict allowlisted result contract.
export async function readProtectedPlanHistory(options) {
  return (await readProtectedPlanHistoryInputs(options)).summary;
}
