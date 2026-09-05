import { describe, expect, it } from "vitest";
import {
  buildDrStorageMirrorProof,
  buildPrimaryStorageMirrorProof,
} from "./dr-storage-mirror.mjs";

const objects = [
  { bucket_id: "product-images", name: "catalog/a.webp" },
  { bucket_id: "store-assets", name: "logos/b.webp" },
];

const manifests = objects.map((object, index) => ({
  bucket: object.bucket_id,
  object_path: object.name,
  replication_status: "MIRRORED",
  primary_checksum: String(index + 1).repeat(64),
  dr_checksum: String(index + 1).repeat(64),
  deleted_at: null,
}));

describe("DR Storage mirror proof", () => {
  it("proves identical object inventories backed by mirrored manifests", () => {
    const proof = buildDrStorageMirrorProof({
      primaryObjects: objects,
      drObjects: [...objects].reverse(),
      manifestRows: manifests,
    });

    expect(proof).toMatchObject({
      storageMirrorVerified: true,
      primaryObjects: 2,
      drObjects: 2,
      manifestRows: 2,
      pendingOrInvalidManifests: 0,
      changesRemoteState: false,
    });
    expect(proof.primaryInventoryDigest).toBe(proof.drInventoryDigest);
  });

  it("accepts an empty mirror without weakening the same checks", () => {
    expect(buildDrStorageMirrorProof({
      primaryObjects: [],
      drObjects: [],
      manifestRows: [],
    })).toMatchObject({
      storageMirrorVerified: true,
      primaryObjects: 0,
      drObjects: 0,
      manifestRows: 0,
    });
  });

  it("accepts a completed deletion tombstone outside the active inventory", () => {
    const proof = buildDrStorageMirrorProof({
      primaryObjects: objects,
      drObjects: [...objects].reverse(),
      manifestRows: [
        ...manifests,
        {
          bucket: "product-images",
          object_path: "catalog/deleted.webp",
          replication_status: "DELETED",
          primary_checksum: null,
          dr_checksum: null,
          deleted_at: new Date("2026-09-05T00:00:00.000Z"),
        },
      ],
    });

    expect(proof).toMatchObject({
      storageMirrorVerified: true,
      primaryObjects: 2,
      drObjects: 2,
      manifestRows: 2,
      pendingOrInvalidManifests: 0,
    });
  });

  it("fails closed for a malformed deletion tombstone", () => {
    const deletedManifest = {
      bucket: "product-images",
      object_path: "catalog/deleted.webp",
      replication_status: "DELETED",
      primary_checksum: null,
      dr_checksum: null,
      deleted_at: new Date("2026-09-05T00:00:00.000Z"),
    };

    for (const override of [
      { deleted_at: null },
      { replication_status: "MIRRORED" },
      { primary_checksum: "a".repeat(64) },
      { dr_checksum: "a".repeat(64) },
    ]) {
      expect(() => buildDrStorageMirrorProof({
        primaryObjects: objects,
        drObjects: objects,
        manifestRows: [...manifests, { ...deletedManifest, ...override }],
      })).toThrow("STORAGE_MANIFEST_INVENTORY_MISMATCH");
    }
  });

  it("fails closed for a missing DR object or manifest", () => {
    expect(() => buildDrStorageMirrorProof({
      primaryObjects: objects,
      drObjects: objects.slice(1),
      manifestRows: manifests,
    })).toThrow("STORAGE_OBJECT_INVENTORY_MISMATCH");

    expect(() => buildDrStorageMirrorProof({
      primaryObjects: objects,
      drObjects: objects,
      manifestRows: manifests.slice(1),
    })).toThrow("STORAGE_MANIFEST_INVENTORY_MISMATCH");
  });

  it("fails closed for pending, deleted, or checksum-mismatched manifests", () => {
    for (const override of [
      { replication_status: "PENDING" },
      { deleted_at: new Date("2026-08-31T00:00:00.000Z") },
      { dr_checksum: "f".repeat(64) },
    ]) {
      expect(() => buildDrStorageMirrorProof({
        primaryObjects: objects,
        drObjects: objects,
        manifestRows: [
          { ...manifests[0], ...override },
          manifests[1],
        ],
      })).toThrow("STORAGE_MANIFEST_NOT_MIRRORED");
    }
  });

  it("captures a Primary-only proof for resume safety", () => {
    const proof = buildPrimaryStorageMirrorProof({
      primaryObjects: objects,
      manifestRows: manifests,
    });

    expect(proof).toMatchObject({
      primaryStorageVerified: true,
      primaryObjects: 2,
      manifestRows: 2,
      pendingOrInvalidManifests: 0,
      changesRemoteState: false,
    });
  });
});
