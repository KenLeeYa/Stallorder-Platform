import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { sealBackup } from "./backup-dr-for-staging.mjs";
import { decryptPartialProofBackup, readOriginalPartialProofBackup, restoreOriginalPartialProofCopy, compareOriginalPartialProofData } from "./staging-partial-retirement-backup.mjs";

const spawnSync = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawnSync }));
const key = " synthetic offline-only key with preserved spaces ";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const ref = "daeqwtpaxcebmtwxqdkj";
const commit = "291c3c56f1dc6ed743f9c7fe67a117f2dac554ff";
const runId = "39647447270";
const ids = ["14e82b29-5b3c-4b8a-819a-f0a16f9db2fd", "ce425c1e-c149-42e0-83b3-590268772896", "f66584a9-6357-4422-8cda-40c8a13c259d"];
const members = {};
function encrypted(name, plaintext) {
  const bytes = sealBackup(plaintext, key);
  members[name] = bytes;
  return { name, bytes: bytes.length, sha256: hash(bytes) };
}
const tables = Array.from({ length: 239 }, (_, index) => ({ schema: "public",
  name: index === 0 ? "print_rules" : `synthetic_${index}`, columns: ["id"] }));
const supplement = { sourceRef: "eyuctbnlvnbnivwasvqr", readOnly: true, columns: ["id"], rows: ids.map(id => ({ id })) };
const dump = Buffer.from("PGDMP synthetic original archive");
const manifest = { version: 3, ref, commit, runId, tables,
  fingerprints: tables.map(table => ({ table: `${table.schema}.${table.name}`, rows: 0, digest: "a".repeat(32) })),
  archive: encrypted("database.dump.enc", dump),
  files: Array.from({ length: 42 }, (_, index) => {
    const bytes = Buffer.from(`synthetic bytes ${index}`);
    return { bucket: "synthetic", objectPath: `original/path ${index}.bin`, plaintextSha256: hash(bytes),
      ...encrypted(`object-${index}.enc`, bytes) };
  }),
  recovery: encrypted("reference-recovery.json.enc", Buffer.from(JSON.stringify(supplement))) };
members["manifest.json.enc"] = sealBackup(Buffer.from(JSON.stringify(manifest)), key);
const proof = { version: 1, ref, commit, runId, encrypted: true, databaseDataRestore: true,
  tableCount: 239, fileCount: 42, restoredOriginalObjectPaths: true, restoredFileReadback: true,
  restoredFileBytes: true, primaryWrites: false, remoteWrites: false, fullProviderRecovery: false,
  recoveryOnlyReferenceRows: 3, originalReplicaSelfContained: false };
const rehearsal = { runId, sourceSha: commit, originalOrders: 827, removedVaultEntries: 7,
  remoteWrites: false, hostedCleanup: false, sequenceRegression: true, applicationRole: "postgres",
  syntheticSafetyOverlay: true, exactCliRemoteResetPath: true, syntheticState: {
    orders: 10, organizations: 2, real_orders: 0, vault: 0, auth_users: 0, files: 0,
    subscriptions: 0, active_crons: 0, enabled_printers: 0, enabled_non_cash: 0, migrations: 146 } };
members["verification.json"] = Buffer.from(JSON.stringify(proof));
members["reset-rehearsal.json"] = Buffer.from(JSON.stringify(rehearsal));
function changedManifest(change) {
  const next = structuredClone(manifest); change(next);
  return { ...members, "manifest.json.enc": sealBackup(Buffer.from(JSON.stringify(next)), key) };
}

describe("original encrypted backup for diagnostic-only partial proof", () => {
  it("decrypts the original archive, all exact-path bytes and only the offline reference supplement", () => {
    const result = decryptPartialProofBackup(members, key);
    expect(result.dump).toEqual(dump);
    expect(result.manifest).toEqual(manifest);
    expect(result.supplement).toEqual(supplement);
    expect(result.files).toHaveLength(42);
    expect(result.files[41]).toEqual({ bucket: "synthetic", objectPath: "original/path 41.bin",
      bytes: Buffer.from("synthetic bytes 41") });
    expect(result.diagnosticOnly).toBe(true);
    expect(result.planQualified).toBe(false);
    expect(result.remainingDataProven).toBe(false);
  });

  it("does not trim the key and sanitizes wrong-key, missing-key and malformed decrypted JSON errors", () => {
    for (const wrong of [key.trim(), undefined, "wrong synthetic key"]) {
      expect(() => decryptPartialProofBackup(members, wrong)).toThrow(/^STAGING_PARTIAL_BACKUP_INVALID$/);
    }
    expect(() => decryptPartialProofBackup({ ...members,
      "manifest.json.enc": sealBackup(Buffer.from("private row must not appear"), key) }, key))
      .toThrow(/^STAGING_PARTIAL_BACKUP_INVALID$/);
  });

  it("rejects an incomplete member set, added paths, encrypted-byte or plaintext-hash tampering", () => {
    const missing = { ...members }; delete missing["object-41.enc"];
    const changed = { ...members, "object-0.enc": Buffer.from(members["object-0.enc"]) };
    changed["object-0.enc"][70] ^= 1;
    for (const input of [missing, { ...members, "../untrusted": Buffer.from("private") }, changed,
      changedManifest(next => { next.files[0].plaintextSha256 = "b".repeat(64); }),
      changedManifest(next => { next.archive.bytes += 1; })]) {
      expect(() => decryptPartialProofBackup(input, key)).toThrow(/^STAGING_PARTIAL_BACKUP_INVALID$/);
    }
  });

  it("rejects source, table, ordered-column, fingerprint and exact object-path scope drift", () => {
    for (const change of [next => { next.ref = "eyuctbnlvnbnivwasvqr"; },
      next => { next.commit = "f".repeat(40); }, next => { next.runId = "999"; },
      next => { next.tables.pop(); }, next => { next.tables[1] = next.tables[0]; },
      next => { next.tables[0].columns = ["id", "id"]; },
      next => { next.fingerprints[1] = next.fingerprints[0]; },
      next => { next.fingerprints[0].rows = -1; },
      next => { next.files[1].objectPath = next.files[0].objectPath; },
      next => { next.files[0].name = "object-1.enc"; }]) {
      expect(() => decryptPartialProofBackup(changedManifest(change), key))
        .toThrow(/^STAGING_PARTIAL_BACKUP_INVALID$/);
    }
  });

  it("retains the real restore/rehearsal evidence and three-reference limitations", () => {
    for (const change of [{ restoredFileReadback: false }, { primaryWrites: true },
      { recoveryOnlyReferenceRows: 4 }, { fullProviderRecovery: true }]) {
      expect(() => decryptPartialProofBackup({ ...members,
        "verification.json": Buffer.from(JSON.stringify({ ...proof, ...change })) }, key))
        .toThrow(/^STAGING_PARTIAL_BACKUP_INVALID$/);
    }
    expect(() => decryptPartialProofBackup({ ...members,
      "reset-rehearsal.json": Buffer.from(JSON.stringify({ ...rehearsal, applicationRole: "supabase_admin" })) }, key))
      .toThrow(/^STAGING_PARTIAL_BACKUP_INVALID$/);
  });

  it("rejects substituted backup ZIPs before parsing or accepting caller-supplied members", () => {
    expect(() => readOriginalPartialProofBackup({ zip: Buffer.from("not original"), members, key }))
      .toThrow(/^STAGING_PARTIAL_BACKUP_ARCHIVE_INVALID$/);
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it("never reaches a restore process when the original archive is unauthenticated", () => {
    expect(() => restoreOriginalPartialProofCopy({ backup: { zip: Buffer.from("untrusted"), key, members },
      retirement: { provenanceValidated: true }, containerId: "a".repeat(64) }))
      .toThrow(/^STAGING_PARTIAL_BACKUP_ARCHIVE_INVALID$/);
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it("never reads hosted data or accepts a supplied current snapshot when backup authentication fails", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    try {
      await expect(compareOriginalPartialProofData({ backup: { zip: Buffer.from("untrusted"), key, members },
        retirement: { provenanceValidated: true }, privateRemainingData: { arbitraryCurrent: true }, containerId: "a".repeat(64) }))
        .rejects.toThrow(/^STAGING_PARTIAL_BACKUP_ARCHIVE_INVALID$/);
      expect(fetch).not.toHaveBeenCalled();
      expect(spawnSync).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it("rejects altered offline reference scope even when its encrypted record is internally consistent", () => {
    for (const change of [{ sourceRef: ref }, { readOnly: false }, { columns: ["id", "extra"] },
      { rows: [{ id: "not-an-approved-parent" }, ...supplement.rows.slice(1)] }]) {
      const bytes = sealBackup(Buffer.from(JSON.stringify({ ...supplement, ...change })), key);
      const input = changedManifest(next => { next.recovery = {
        name: "reference-recovery.json.enc", bytes: bytes.length, sha256: hash(bytes) }; });
      input["reference-recovery.json.enc"] = bytes;
      expect(() => decryptPartialProofBackup(input, key)).toThrow(/^STAGING_PARTIAL_BACKUP_INVALID$/);
    }
  });
});
