import { createHash } from "node:crypto";

export class DrStorageMirrorError extends Error {
  constructor(code) {
    super(code);
    this.name = "DrStorageMirrorError";
    this.code = code;
  }
}

export function buildPrimaryStorageMirrorProof({ primaryObjects, manifestRows }) {
  const primaryInventory = normalizeObjects(primaryObjects);
  const manifests = normalizeManifests(manifestRows);
  const manifestByObject = new Map(manifests.map((manifest) => [manifest.key, manifest]));
  const objectKeys = new Set(primaryInventory.map((object) => object.key));

  for (const object of primaryInventory) {
    if (!manifestByObject.has(object.key)) {
      throw new DrStorageMirrorError("STORAGE_MANIFEST_INVENTORY_MISMATCH");
    }
  }
  for (const manifest of manifests) {
    if (!objectKeys.has(manifest.key) && !isCompletedDeletion(manifest)) {
      throw new DrStorageMirrorError("STORAGE_MANIFEST_INVENTORY_MISMATCH");
    }
  }

  const activeManifests = primaryInventory.map((object) => manifestByObject.get(object.key));
  const pendingOrInvalidManifests = activeManifests.filter(
    (manifest) => !isMirrored(manifest),
  ).length;
  if (pendingOrInvalidManifests > 0) {
    throw new DrStorageMirrorError("STORAGE_MANIFEST_NOT_MIRRORED");
  }

  return {
    primaryStorageVerified: true,
    primaryObjects: primaryInventory.length,
    primaryInventoryDigest: digest(primaryInventory.map(publicObject)),
    manifestRows: activeManifests.length,
    manifestDigest: digest(activeManifests.map(publicManifest)),
    pendingOrInvalidManifests,
    changesRemoteState: false,
  };
}

export function buildDrStorageMirrorProof({ primaryObjects, drObjects, manifestRows }) {
  const primaryProof = buildPrimaryStorageMirrorProof({ primaryObjects, manifestRows });
  const drInventory = normalizeObjects(drObjects);
  const drInventoryDigest = digest(drInventory.map(publicObject));
  if (
    primaryProof.primaryObjects !== drInventory.length
    || primaryProof.primaryInventoryDigest !== drInventoryDigest
  ) {
    throw new DrStorageMirrorError("STORAGE_OBJECT_INVENTORY_MISMATCH");
  }

  return {
    storageMirrorVerified: true,
    primaryObjects: primaryProof.primaryObjects,
    drObjects: drInventory.length,
    primaryInventoryDigest: primaryProof.primaryInventoryDigest,
    drInventoryDigest,
    manifestRows: primaryProof.manifestRows,
    manifestDigest: primaryProof.manifestDigest,
    pendingOrInvalidManifests: primaryProof.pendingOrInvalidManifests,
    changesRemoteState: false,
  };
}

function normalizeObjects(rows) {
  const normalized = rows.map((row) => {
    const bucketId = String(row.bucket_id ?? row.bucketId ?? "");
    const name = String(row.name ?? "");
    if (!bucketId || !name) throw new DrStorageMirrorError("STORAGE_OBJECT_INVENTORY_INVALID");
    return { key: objectKey(bucketId, name), bucketId, name };
  }).sort(compareByKey);
  assertUniqueKeys(normalized, "STORAGE_OBJECT_INVENTORY_INVALID");
  return normalized;
}

function normalizeManifests(rows) {
  const normalized = rows.map((row) => {
    const bucket = String(row.bucket ?? "");
    const objectPath = String(row.object_path ?? row.objectPath ?? "");
    if (!bucket || !objectPath) {
      throw new DrStorageMirrorError("STORAGE_MANIFEST_INVENTORY_INVALID");
    }
    return {
      key: objectKey(bucket, objectPath),
      bucket,
      objectPath,
      replicationStatus: String(row.replication_status ?? row.replicationStatus ?? ""),
      primaryChecksum: nullableString(row.primary_checksum ?? row.primaryChecksum),
      drChecksum: nullableString(row.dr_checksum ?? row.drChecksum),
      deletedAt: row.deleted_at ?? row.deletedAt ?? null,
    };
  }).sort(compareByKey);
  assertUniqueKeys(normalized, "STORAGE_MANIFEST_INVENTORY_INVALID");
  return normalized;
}

function isMirrored(manifest) {
  return manifest.deletedAt === null
    && manifest.replicationStatus === "MIRRORED"
    && isChecksum(manifest.primaryChecksum)
    && manifest.drChecksum === manifest.primaryChecksum;
}

function isCompletedDeletion(manifest) {
  return manifest.deletedAt !== null
    && manifest.replicationStatus === "DELETED"
    && manifest.primaryChecksum === null
    && manifest.drChecksum === null;
}

function publicObject({ bucketId, name }) {
  return { bucketId, name };
}

function publicManifest({ bucket, objectPath, primaryChecksum, drChecksum }) {
  return { bucket, objectPath, primaryChecksum, drChecksum };
}

function objectKey(bucket, name) {
  return JSON.stringify([bucket, name]);
}

function assertUniqueKeys(rows, code) {
  if (new Set(rows.map((row) => row.key)).size !== rows.length) {
    throw new DrStorageMirrorError(code);
  }
}

function compareByKey(left, right) {
  if (left.key < right.key) return -1;
  if (left.key > right.key) return 1;
  return 0;
}

function nullableString(value) {
  return value === null || value === undefined ? null : String(value);
}

function isChecksum(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
