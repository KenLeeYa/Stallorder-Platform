import "server-only";
import { sign, verify, type KeyObject } from "node:crypto";

export type ArchiveEntry = { sequence: string; auditId: string; digest: string };
export type ArchiveManifest = { version: 1; batchId: string; previousDigest: string | null; count: number; entries: ArchiveEntry[] };
function bytes(manifest: ArchiveManifest) {
  if (manifest.version !== 1 || !manifest.batchId || manifest.entries.length !== manifest.count || !manifest.count || manifest.count > 1000) throw new Error("ARCHIVE_MANIFEST_INVALID");
  const ids = new Set<string>();
  let previous = BigInt(0);
  for (const entry of manifest.entries) {
    if (!/^[1-9][0-9]*$/.test(entry.sequence) || BigInt(entry.sequence) <= previous || ids.has(entry.auditId) || !/^[a-f0-9]{64}$/.test(entry.digest)) throw new Error("ARCHIVE_MANIFEST_INVALID");
    previous = BigInt(entry.sequence); ids.add(entry.auditId);
  }
  return Buffer.from(JSON.stringify([manifest.version, manifest.batchId, manifest.previousDigest, manifest.count,
    manifest.entries.map((entry) => [entry.sequence, entry.auditId, entry.digest])]));
}
export function signManifest(manifest: ArchiveManifest, privateKey: KeyObject) {
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("ARCHIVE_KEY_INVALID");
  return sign(null, bytes(manifest), privateKey).toString("base64url");
}
export function verifyManifest(manifest: ArchiveManifest, signature: string, publicKey: KeyObject, expectedPreviousDigest: string | null) {
  try {
    return publicKey.asymmetricKeyType === "ed25519" && manifest.previousDigest === expectedPreviousDigest
      && verify(null, bytes(manifest), publicKey, Buffer.from(signature, "base64url"));
  } catch { return false; }
}
// Provider configuration must supply a independently controlled archive and a
// receipt from its readback. A local signature is not WORM or archive delivery.
export interface AuditArchive { put(batch: ArchiveManifest, signature: string): Promise<{ objectId: string; checksum: string; readbackVerified: true }> }
export class UnconfiguredAuditArchive implements AuditArchive {
  async put(): Promise<never> { throw new Error("AUDIT_ARCHIVE_NOT_CONFIGURED"); }
}
