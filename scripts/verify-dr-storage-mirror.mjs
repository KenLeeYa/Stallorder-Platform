import { PrismaClient } from "@prisma/client";
import {
  buildDrStorageMirrorProof,
  buildPrimaryStorageMirrorProof,
  DrStorageMirrorError,
} from "./lib/dr-storage-mirror.mjs";

const primaryOnly = process.argv.slice(2).includes("--primary-only");
const primary = new PrismaClient({
  datasources: { db: { url: requiredPostgresUrl("DIRECT_URL") } },
});
const dr = primaryOnly
  ? null
  : new PrismaClient({
      datasources: { db: { url: requiredPostgresUrl("DR_DIRECT_URL") } },
    });

try {
  const [primaryObjects, manifestRows, drObjects] = await Promise.all([
    readStorageObjects(primary),
    readStorageManifests(primary),
    dr ? readStorageObjects(dr) : Promise.resolve(null),
  ]);
  const proof = drObjects
    ? buildDrStorageMirrorProof({ primaryObjects, drObjects, manifestRows })
    : buildPrimaryStorageMirrorProof({ primaryObjects, manifestRows });
  console.log(JSON.stringify({
    event: primaryOnly
      ? "primary_storage_inventory_verified"
      : "dr_storage_mirror_verified",
    source: "PRIMARY",
    target: primaryOnly ? null : "DR",
    ...proof,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    event: "dr_storage_mirror_verification_failed",
    reason: safeReason(error),
  }));
  process.exitCode = 1;
} finally {
  await Promise.allSettled([
    primary.$disconnect(),
    dr?.$disconnect(),
  ]);
}

function readStorageObjects(database) {
  return database.$queryRawUnsafe(
    "select bucket_id, name from storage.objects order by bucket_id, name",
  );
}

function readStorageManifests(database) {
  return database.$queryRawUnsafe(
    `select
       bucket,
       object_path,
       replication_status,
       primary_checksum,
       dr_checksum,
       deleted_at
     from public.storage_object_manifest
     order by bucket, object_path`,
  );
}

function requiredPostgresUrl(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new DrStorageMirrorError(`${name}_MISSING`);
  try {
    const parsed = new URL(value);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error();
  } catch {
    throw new DrStorageMirrorError(`${name}_INVALID`);
  }
  return value;
}

function safeReason(error) {
  return error instanceof DrStorageMirrorError
    ? error.code
    : "DR_STORAGE_MIRROR_VERIFICATION_FAILED";
}
