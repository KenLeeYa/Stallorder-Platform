import { generateKeyPairSync } from "node:crypto";
import { expect, it } from "vitest";
import { signManifest, verifyManifest, type ArchiveManifest, UnconfiguredAuditArchive } from "./archive";
it("detects replacement, removal, reorder and a missing predecessor with an independently held verification key", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const manifest: ArchiveManifest = { version: 1, batchId: "batch-1", previousDigest: "a".repeat(64), count: 2,
    entries: [{ sequence: "10", auditId: "a", digest: "b".repeat(64) }, { sequence: "12", auditId: "b", digest: "c".repeat(64) }] };
  const signature = signManifest(manifest, privateKey);
  expect(verifyManifest(manifest, signature, publicKey, manifest.previousDigest)).toBe(true);
  expect(verifyManifest({ ...manifest, entries: manifest.entries.slice(1) }, signature, publicKey, manifest.previousDigest)).toBe(false);
  expect(verifyManifest({ ...manifest, entries: [...manifest.entries].reverse() }, signature, publicKey, manifest.previousDigest)).toBe(false);
  expect(verifyManifest({ ...manifest, count: 1, entries: manifest.entries.slice(1) }, signature, publicKey, manifest.previousDigest)).toBe(false);
  expect(verifyManifest(manifest, signature, publicKey, null)).toBe(false);
  await expect(new UnconfiguredAuditArchive().put()).rejects.toThrow("AUDIT_ARCHIVE_NOT_CONFIGURED");
});
