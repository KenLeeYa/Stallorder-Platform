// Original-backup input boundary for an offline, diagnostic-only proof. This is
// not a workflow entry point and cannot qualify or execute a continuation.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { openBackup } from "./backup-dr-for-staging.mjs";
import { assertRestorationEvidence } from "./convert-dr-to-staging.mjs";
import { readFailedRetirementEvidence } from "./staging-partial-retirement-proof.mjs";
import { restoreAndReplayPartialProofCopy } from "./staging-partial-retirement-restore.mjs";
import { compareRemainingSnapshotReadOnly } from "./staging-partial-retirement-snapshot.mjs";

const runId = "39647447270";
const commit = "291c3c56f1dc6ed743f9c7fe67a117f2dac554ff";
const branch = "codex/dr-staging-transition-20261022";
const digest = "fbab2a1c9b481c60ad4e8d67442c1842055ec72ba0f12d09c18f34ee324f5cd9";
const names = ["manifest.json.enc", "database.dump.enc", "reference-recovery.json.enc",
  "verification.json", "reset-rehearsal.json", ...Array.from({ length: 42 }, (_, index) => `object-${index}.enc`)];
const recoveryIds = ["14e82b29-5b3c-4b8a-819a-f0a16f9db2fd", "ce425c1e-c149-42e0-83b3-590268772896", "f66584a9-6357-4422-8cda-40c8a13c259d"];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function requireBackup(condition) { if (!condition) throw new Error("STAGING_PARTIAL_BACKUP_INVALID"); }

// The caller obtains fresh GitHub metadata and raw ZIP bytes. Caller-extracted
// members are never accepted here. The runner-only key stays in this process.
export function assertOriginalPartialProofArchive({ run, artifact, zip, now = new Date() }) {
  if (!(Buffer.isBuffer(zip) && zip.length === 9441387 && hash(zip) === digest
    && run?.id === Number(runId) && run.run_attempt === 1 && run.head_sha === commit
    && run.head_branch === branch && run.path === ".github/workflows/dr-staging-backup.yml"
    && run.repository?.full_name === "KenLeeYa/Stallorder-Platform" && run.event === "push"
    && run.actor?.login === "KenLeeYa" && run.triggering_actor?.login === "KenLeeYa"
    && run.status === "completed" && run.conclusion === "success"
    && artifact?.id === 12368487539 && artifact.name === `dr-retirement-encrypted-${runId}`
    && artifact.size_in_bytes === zip.length && artifact.digest === `sha256:${digest}`
    && artifact.expired === false && Date.parse(artifact.expires_at) > now.getTime()
    && artifact.workflow_run?.id === Number(runId) && artifact.workflow_run.head_sha === commit
    && artifact.workflow_run.head_branch === branch && artifact.workflow_run.repository_id === 1298874780
    && artifact.workflow_run.head_repository_id === 1298874780)) {
    throw new Error("STAGING_PARTIAL_BACKUP_ARCHIVE_INVALID");
  }
}

export function readOriginalPartialProofBackup({ run, artifact, zip, key, now = new Date() }) {
  assertOriginalPartialProofArchive({ run, artifact, zip, now });
  // Standard-library ZIP decoding only: no extraction, key, provider environment,
  // pickle, imported archive code or arbitrary paths. Bound expanded bytes too.
  const script = `import base64,io,json,sys,zipfile
expected=json.loads(sys.argv[1])
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as archive:
    entries=archive.infolist()
    if sorted(e.filename for e in entries) != sorted(expected) or sum(e.file_size for e in entries) > 16777216:
        raise ValueError("invalid archive")
    values={}
    for entry in entries:
        bound=16384 if entry.filename.endswith('.json') else 8388608
        if entry.file_size > bound or entry.is_dir():
            raise ValueError("invalid member")
        values[entry.filename]=base64.b64encode(archive.read(entry)).decode('ascii')
    print(json.dumps(values))`;
  try {
    const result = spawnSync(process.platform === "win32" ? "python" : "python3",
      ["-I", "-c", script, JSON.stringify(names)], { input: zip, encoding: "utf8",
        env: Object.fromEntries(Object.entries(process.env).filter(([name]) => ["PATH", "SYSTEMROOT"].includes(name.toUpperCase()))),
        timeout: 10_000, maxBuffer: 24 * 1024 * 1024, windowsHide: true });
    requireBackup(!result.error && result.status === 0);
    const encoded = JSON.parse(result.stdout);
    requireBackup(isDeepStrictEqual(Object.keys(encoded).sort(), [...names].sort()));
    const members = Object.fromEntries(names.map(name => {
      requireBackup(typeof encoded[name] === "string");
      const bytes = Buffer.from(encoded[name], "base64");
      requireBackup(bytes.toString("base64") === encoded[name]);
      return [name, bytes];
    }));
    return decryptPartialProofBackup(members, key);
  } catch {
    throw new Error("STAGING_PARTIAL_BACKUP_INVALID");
  }
}

// Authenticate all three immutable archives before Docker receives any original
// plaintext. Only a fresh isolated copy is written. The private replay snapshot
// in this return value must never be logged or uploaded as a receipt.
export function restoreOriginalPartialProofCopy({ backup, retirement, containerId }) {
  // Reject corrupt historical identity before decrypting; still recheck against
  // the actual manifest file count below before giving plaintext to Docker.
  if (retirement?.mode === "consumed-plan-history-v1") {
    requireBackup(backup && !("now" in backup));
    assertOriginalPartialProofArchive(backup);
    readFailedRetirementEvidence(retirement);
  }
  const original = readOriginalPartialProofBackup(backup);
  readFailedRetirementEvidence({ ...retirement, fileCount: original.manifest.files.length,
    backup: { runId, commit, artifactId: 12368487539, artifactDigest: `sha256:${digest}` } });
  const restored = restoreAndReplayPartialProofCopy({ containerId, dump: original.dump,
    manifest: original.manifest, supplement: original.supplement });
  return { ...restored, backupRunId: runId, fileBytesVerified: original.files.length };
}

// Low-level composition, not a protected workflow entry. All expected data comes
// from the authenticated restore/replay, not a caller-supplied current snapshot.
// Row/catalog reads share one statement; sequence state is still non-MVCC.
// Full environment/provider/entry/
// source/Primary proof is still missing: this cannot serve as a Plan gate.
export async function compareOriginalPartialProofData(input) {
  const { privateRemainingData, privateRemainingSchema, ...summary } = restoreOriginalPartialProofCopy(input);
  const compared = await compareRemainingSnapshotReadOnly({ data: privateRemainingData.snapshot,
    schema: privateRemainingSchema }, privateRemainingData.tables);
  return { ...summary, ...compared };
}

// Low-level cryptographic/content validation, NOT archive provenance. Tests use
// synthetic sealed bundles; production must enter through the pinned reader above.
// Returned buffers are private process data, never a log or uploadable receipt.
export function decryptPartialProofBackup(members, key) {
  try {
    requireBackup(typeof key === "string" && key.length >= 24
      && isDeepStrictEqual(Object.keys(members).sort(), [...names].sort())
      && names.every(name => Buffer.isBuffer(members[name])));
    const manifest = JSON.parse(openBackup(members["manifest.json.enc"], key).toString("utf8"));
    const proof = JSON.parse(members["verification.json"].toString("utf8"));
    const rehearsal = JSON.parse(members["reset-rehearsal.json"].toString("utf8"));
    assertRestorationEvidence(proof, manifest, rehearsal, { runId, commit }, 146);
    requireBackup(manifest.tables.length === 239 && manifest.files.length === 42
      && proof.recoveryOnlyReferenceRows === 3 && proof.fullProviderRecovery === false
      && proof.originalReplicaSelfContained === false && rehearsal.originalOrders === 827
      && rehearsal.removedVaultEntries === 7 && rehearsal.syntheticState.orders === 10);
    const tableNames = manifest.tables.map(({ schema, name, columns }) => {
      requireBackup(["public", "auth", "storage", "app_private", "internal", "vault"].includes(schema)
        && typeof name === "string" && name.length > 0 && !name.includes("\0")
        && Array.isArray(columns) && columns.length > 0
        && columns.every(column => typeof column === "string" && column.length > 0 && !column.includes("\0"))
        && new Set(columns).size === columns.length);
      return `${schema}.${name}`;
    });
    requireBackup(new Set(tableNames).size === tableNames.length
      && Array.isArray(manifest.fingerprints) && manifest.fingerprints.length === tableNames.length
      && isDeepStrictEqual(manifest.fingerprints.map(item => item.table).sort(), [...tableNames].sort())
      && manifest.fingerprints.every(item => Number.isSafeInteger(item.rows) && item.rows >= 0 && /^[a-f0-9]{32}$/.test(item.digest)));
    function decryptRecord(record, name) {
      const bytes = members[name];
      requireBackup(record?.name === name && record.bytes === bytes.length && record.sha256 === hash(bytes));
      return openBackup(bytes, key);
    }
    const dump = decryptRecord(manifest.archive, "database.dump.enc");
    requireBackup(dump.subarray(0, 5).toString() === "PGDMP");
    const supplement = JSON.parse(decryptRecord(manifest.recovery, "reference-recovery.json.enc").toString("utf8"));
    const columns = manifest.tables.find(table => table.schema === "public" && table.name === "print_rules")?.columns;
    requireBackup(supplement.sourceRef === "eyuctbnlvnbnivwasvqr" && supplement.readOnly === true
      && columns && isDeepStrictEqual(supplement.columns, columns)
      && isDeepStrictEqual(supplement.rows.map(row => row.id).sort(), recoveryIds)
      && supplement.rows.every(row => isDeepStrictEqual(Object.keys(row).sort(), [...columns].sort())));
    // Parent tenancy and exact added-row readback are checked by the isolated
    // restore adapter against the restored original printers, not new Primary data.
    const filePaths = new Set();
    const files = manifest.files.map((file, index) => {
      requireBackup(typeof file.bucket === "string" && file.bucket.length > 0 && !file.bucket.includes("\0")
        && typeof file.objectPath === "string" && file.objectPath.length > 0 && !file.objectPath.includes("\0"));
      const path = `${file.bucket}\0${file.objectPath}`;
      requireBackup(!filePaths.has(path)); filePaths.add(path);
      const bytes = decryptRecord(file, `object-${index}.enc`);
      requireBackup(hash(bytes) === file.plaintextSha256);
      return { bucket: file.bucket, objectPath: file.objectPath, bytes };
    });
    return { manifest, dump, supplement, files, diagnosticOnly: true, planQualified: false, remainingDataProven: false };
  } catch {
    // JSON, crypto and assertion failures may contain private row data. Never
    // propagate their message, cause, stdout, stderr or raw decrypted values.
    throw new Error("STAGING_PARTIAL_BACKUP_INVALID");
  }
}
