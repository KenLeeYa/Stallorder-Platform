// Read-only proof candidate, not a continuation Plan or an executable Apply.
// Archive authentication and original-backup replay must precede any data claim.
import { isDeepStrictEqual } from "node:util";
import { spawnSync } from "node:child_process";
import { conversionDigest, STAGING_TARGET } from "./dr-staging-conversion-plan.mjs";
import { validateProductionApprovalReceipt } from "./lib/production-approval.mjs";

const repository = "KenLeeYa/Stallorder-Platform";
const source = "32e9de2cf325240679c1a56f336b4c0f8c9d6664";
const tree = "f585a481acc6718f0aa11aed1a0983c143aa128b";
const backupIdentity = Object.freeze({ runId: "39647447270", commit: "291c3c56f1dc6ed743f9c7fe67a117f2dac554ff",
  artifactId: 12368487539, artifactDigest: "sha256:fbab2a1c9b481c60ad4e8d67442c1842055ec72ba0f12d09c18f34ee324f5cd9" });
const completed = ["immutable-plan", "original-data-matches-qualified-backup",
  "protected-entry-and-token-edit-permissions", "independent-provider-credentials",
  "old-files-deleted-with-readback", "old-vault-and-private-schemas-retired"];
const archives = {
  apply: { id: 12497707244, runId: 39944614570, name: "dr-staging-conversion-39944614570", bytes: 20984,
    sha256: "6e453c336b9437d2e74bb9e14cc2c38029ebf2364617eb8dbacc3406c367e304",
    members: ["staging-conversion-progress.json", "staging-storage-retirement.json"] },
  plan: { id: 12497002610, runId: 39944190461, name: "dr-staging-plan-39944190461", bytes: 2508,
    sha256: "252c10206aff140cf3d27cb0d1a4139929d7efc5c87f44b4230ffdc7341977e7",
    members: ["dr-staging-transition-plan.json", "dr-staging-approval.json"] },
};

function requireEvidence(condition, code) {
  if (!condition) throw new Error(`STAGING_PARTIAL_${code}`);
}

function validateRun(run, id, conclusion) {
  requireEvidence(String(run?.id) === id && run.run_attempt === 1
    && run.repository?.full_name === repository && run.path === ".github/workflows/dr-staging-conversion.yml"
    && run.head_branch === "main" && run.head_sha === source && run.event === "workflow_dispatch"
    && run.actor?.login === "KenLeeYa" && run.triggering_actor?.login === "KenLeeYa"
    && run.status === "completed" && run.conclusion === conclusion, "RUN_INVALID");
}

function readArchive(kind, metadata, bytes, now, members = archives[kind].members) {
  const expected = archives[kind];
  requireEvidence(Buffer.isBuffer(bytes) && bytes.length === expected.bytes
    && conversionDigest(bytes) === expected.sha256 && metadata?.id === expected.id
    && metadata.name === expected.name && metadata.size_in_bytes === expected.bytes
    && metadata.expired === false && Date.parse(metadata.expires_at) > now.getTime()
    && metadata.digest === `sha256:${expected.sha256}`
    && metadata.workflow_run?.id === expected.runId && metadata.workflow_run.head_sha === source
    && metadata.workflow_run.head_branch === "main" && metadata.workflow_run.repository_id === 1298874780
    && metadata.workflow_run.head_repository_id === 1298874780, "ARCHIVE_INVALID");
  // Parse only these bounded JSON members from the authenticated bytes. No path
  // extraction, host file access, inherited provider secrets or untrusted code.
  const script = `import io,json,sys,zipfile
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as archive:
    values=[]
    for name in json.loads(sys.argv[1]):
        matches=[entry for entry in archive.infolist() if entry.filename == name]
        if len(matches) != 1 or matches[0].file_size > 16384:
            raise ValueError("invalid member")
        values.append(json.loads(archive.read(matches[0])))
    print(json.dumps(values))`;
  const environment = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => ["PATH", "SYSTEMROOT"].includes(key.toUpperCase())));
  const result = spawnSync(process.platform === "win32" ? "python" : "python3",
    ["-I", "-c", script, JSON.stringify(members)], {
      input: bytes, encoding: "utf8", env: environment, timeout: 10_000, maxBuffer: 65_536, windowsHide: true,
    });
  requireEvidence(!result.error && result.status === 0, "ARCHIVE_READ_FAILED");
  try {
    const documents = JSON.parse(result.stdout);
    requireEvidence(Array.isArray(documents) && documents.length === members.length, "ARCHIVE_READ_FAILED");
    return documents;
  } catch {
    throw new Error("STAGING_PARTIAL_ARCHIVE_READ_FAILED");
  }
}

// Live GitHub metadata and both downloaded ZIPs are required. No unverified
// extracted document supplied by the caller can replace either immutable input.
export function readFailedRetirementEvidence(input) {
  const { applyRun, planRun, applyArtifact, planArtifact, applyZip, planZip, now = new Date() } = input;
  validateRun(applyRun, "39944614570", "failure");
  validateRun(planRun, "39944190461", "success");
  const [progress, storage] = readArchive("apply", applyArtifact, applyZip, now);
  const [plan, approval] = readArchive("plan", planArtifact, planZip, now);
  return validateFailedRetirementEvidence({ ...input, plan, approval, progress, storage, now });
}

// PRIVATE baseline for read-only entry comparison. Never upload the returned
// provider/Primary detail or use it as a new Plan/credential-restoration receipt.
export function readFailedRetirementEntryEvidence(input) {
  const provenance = readFailedRetirementEvidence(input);
  const now = input.now ?? new Date();
  const [entry, retired] = readArchive("apply", input.applyArtifact, input.applyZip, now,
    ["staging-access-entry.json", "staging-retired-aliases.json"]);
  const [plan] = readArchive("plan", input.planArtifact, input.planZip, now);
  requireEvidence(isDeepStrictEqual(entry, { sourceSha: source, planDigest: conversionDigest(plan),
    appId: "aca3efa4-4177-4b4d-8a34-e733f7cecc33", dnsId: "871c47f7090278db84e56ae6da1c1547",
    qaTokenId: "2f063e5f-5f2a-4ebe-af09-f1a0d21425e1", qaPolicyId: "4bcbbc06-babc-404f-bdf9-21c4ca8bb151",
    domainAttached: true, ready: true }) && isDeepStrictEqual(retired, { sourceSha: source,
    retired: plan.providerPrestate?.retiredAliases, oldGeneratedOriginSsoProtected: true, primaryWrites: false }),
  "ENTRY_RECEIPT_INVALID");
  return { provenance, entry, primary: plan.primary, provider: plan.providerPrestate };
}

// These documents must come from authenticated immutable artifacts, not a new
// snapshot of today's partially retired DR. This stage never asserts equivalence.
export function validateFailedRetirementEvidence({ applyRun, planRun, plan, approval,
  backup, progress, storage, fileCount, now = new Date() }) {
  validateRun(applyRun, "39944614570", "failure");
  validateRun(planRun, "39944190461", "success");
  requireEvidence(isDeepStrictEqual(backup, backupIdentity)
    && isDeepStrictEqual(plan?.backup, backupIdentity), "BACKUP_MISMATCH");
  requireEvidence(plan?.schemaVersion === 1 && plan.sourceSha === source
    && isDeepStrictEqual(plan.target, STAGING_TARGET) && plan.migrationCount === 146, "PLAN_MISMATCH");
  const planDigest = conversionDigest(plan);
  // Preserve the existing immutable receipt/expiry checks. A successful historical
  // validation does not unconsume this Plan or authorize another Apply.
  try {
    validateProductionApprovalReceipt({ receipt: approval, runMetadata: planRun, now,
      expected: { repository, planRunId: "39944190461", commitSha: source, treeSha: tree,
        stagingTreeSha: tree, operation: "dr-staging-conversion", repositoryOwner: "KenLeeYa",
        applyActor: "KenLeeYa", parameters: { backupRunId: backupIdentity.runId, primaryWrites: false,
          targetRef: STAGING_TARGET.ref, transitionSnapshotSha256: planDigest } } });
  } catch {
    throw new Error("STAGING_PARTIAL_APPROVAL_INVALID");
  }
  requireEvidence(isDeepStrictEqual(progress, { sourceSha: source, planDigest, completed, primaryWrites: false }),
    "CHECKPOINT_MISMATCH");
  requireEvidence(fileCount === 42 && isDeepStrictEqual(storage, { ref: STAGING_TARGET.ref,
    sourceSha: source, filesRemoved: fileCount, exactBackupPaths: true, bytesCheckedBeforeDelete: true,
    authenticatedReadbackMissing: true, primaryWrites: false }), "STORAGE_RECEIPT_INVALID");
  return { failedApplyRunId: "39944614570", consumedPlanRunId: "39944190461",
    backupRunId: backupIdentity.runId, diagnosticOnly: true, planQualified: false,
    provenanceValidated: true, remainingDataProven: false, remoteWrites: false };
}
