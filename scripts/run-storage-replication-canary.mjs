import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const bucket = "offline-menu-snapshots";
const folder = "system-canary/storage";
const waitSeconds = integerAfter("--wait-seconds", 420, 30, 900);

if (!apply) {
  console.log(JSON.stringify({
    event: "storage_dr_canary_planned",
    mode: "dry-run",
    customerData: false,
    bucket,
    writes: [
      "Create one random JSON object in Primary Storage.",
      "Create one Primary storage manifest and one replication outbox job.",
    ],
    verification: [
      "Wait for the deployed production replication cron.",
      "Download both objects and compare SHA-256 checksums.",
      "Confirm the manifest reaches MIRRORED.",
    ],
    rollback: [
      "Delete the Primary and DR Storage objects.",
      "Delete the Primary manifest and its cascading outbox job.",
      "Wait for the manifest deletion to replicate to DR.",
    ],
  }));
  process.exit(0);
}

const confirmation = required("DR_CHANGE_CONFIRMATION");
if (confirmation !== "PROVE_STORAGE_DR") throw new Error("CONFIRMATION_REQUIRED_PROVE_STORAGE_DR");
if (required("PRODUCTION_ENVIRONMENT_APPROVED") !== "true") {
  throw new Error("PRODUCTION_ENVIRONMENT_NOT_APPROVED");
}

const primaryDatabase = new PrismaClient({
  datasources: { db: { url: required("DIRECT_URL") } },
});
const drDatabase = new PrismaClient({
  datasources: { db: { url: required("DR_DIRECT_URL") } },
});
const primaryStorage = storageClient("PRIMARY_SUPABASE_URL", "PRIMARY_SUPABASE_SECRET_KEY");
const drStorage = storageClient("DR_SUPABASE_URL", "DR_SUPABASE_SECRET_KEY");
const canaryId = randomUUID();
const objectPath = `${folder}/${canaryId}.json`;
const bytes = new TextEncoder().encode(JSON.stringify({
  kind: "stallorder-storage-dr-canary",
  canaryId,
  createdAt: new Date().toISOString(),
}));
const checksum = sha256(bytes);
let manifestId = null;
let startedAt = null;
let proof = null;
let failure = null;

try {
  startedAt = Date.now();
  await upload(primaryStorage, bytes);
  const manifest = await primaryDatabase.$transaction(async (transaction) => {
    const created = await transaction.storageObjectManifest.create({
      data: {
        organizationId: null,
        bucket,
        objectPath,
        contentType: "application/json",
        primaryChecksum: checksum,
        primaryUpdatedAt: new Date(),
        replicationStatus: "PENDING",
      },
    });
    await transaction.storageReplicationJob.create({
      data: {
        manifestId: created.id,
        sourceBackendCode: "PRIMARY",
        targetBackendCode: "DR",
      },
    });
    return created;
  });
  manifestId = manifest.id;

  const mirrored = await waitForMirror(manifest.id);
  const [primaryBytes, drBytes] = await Promise.all([
    download(primaryStorage),
    download(drStorage),
  ]);
  const primaryChecksum = sha256(primaryBytes);
  const drChecksum = sha256(drBytes);
  if (primaryChecksum !== checksum) throw new Error("PRIMARY_CANARY_CHECKSUM_MISMATCH");
  if (drChecksum !== checksum || mirrored.drChecksum !== checksum) {
    throw new Error("DR_CANARY_CHECKSUM_MISMATCH");
  }
  proof = {
    event: "storage_dr_canary_verified",
    canaryId,
    customerData: false,
    primaryChecksum,
    drChecksum,
    manifestStatus: mirrored.replicationStatus,
    mirrorDurationMs: Date.now() - startedAt,
  };
} catch (error) {
  failure = safeReason(error);
} finally {
  const cleanup = await cleanupCanary();
  await Promise.allSettled([primaryDatabase.$disconnect(), drDatabase.$disconnect()]);
  if (!cleanup.completed && !failure) failure = "STORAGE_CANARY_CLEANUP_FAILED";
  if (proof) proof.cleanup = cleanup;
}

if (failure) {
  console.error(JSON.stringify({ event: "storage_dr_canary_failed", reason: failure }));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(proof));
}

async function upload(client, content) {
  const result = await client.storage.from(bucket).upload(objectPath, content, {
    upsert: false,
    cacheControl: "60",
    contentType: "application/json",
  });
  if (result.error) throw new Error("PRIMARY_CANARY_UPLOAD_FAILED");
}

async function download(client) {
  const result = await client.storage.from(bucket).download(objectPath);
  if (result.error || !result.data) throw new Error("CANARY_DOWNLOAD_FAILED");
  return new Uint8Array(await result.data.arrayBuffer());
}

async function waitForMirror(id) {
  const deadline = Date.now() + waitSeconds * 1_000;
  while (Date.now() < deadline) {
    const manifest = await primaryDatabase.storageObjectManifest.findUnique({ where: { id } });
    if (!manifest) throw new Error("STORAGE_CANARY_MANIFEST_MISSING");
    if (manifest.replicationStatus === "MIRRORED") return manifest;
    if (manifest.replicationStatus === "FAILED") throw new Error("STORAGE_CANARY_REPLICATION_FAILED");
    await delay(5_000);
  }
  throw new Error("STORAGE_CANARY_REPLICATION_TIMEOUT");
}

async function cleanupCanary() {
  let completed = true;
  if (manifestId) {
    try {
      await primaryDatabase.storageObjectManifest.delete({ where: { id: manifestId } });
    } catch {
      completed = false;
    }
  }
  const removals = await Promise.allSettled([
    primaryStorage.storage.from(bucket).remove([objectPath]),
    drStorage.storage.from(bucket).remove([objectPath]),
  ]);
  if (removals.some((result) => result.status === "rejected" || result.value.error)) completed = false;

  if (manifestId) {
    const deadline = Date.now() + 60_000;
    let removedFromDr = false;
    while (Date.now() < deadline) {
      try {
        const remaining = await drDatabase.storageObjectManifest.findUnique({ where: { id: manifestId } });
        if (!remaining) {
          removedFromDr = true;
          break;
        }
      } catch {
        break;
      }
      await delay(2_000);
    }
    if (!removedFromDr) completed = false;
  }

  await delay(2_000);
  const finalRemovals = await Promise.allSettled([
    primaryStorage.storage.from(bucket).remove([objectPath]),
    drStorage.storage.from(bucket).remove([objectPath]),
  ]);
  if (finalRemovals.some((result) => result.status === "rejected" || result.value.error)) completed = false;
  return { completed, primaryObjectRemoved: completed, drObjectRemoved: completed, manifestRemoved: completed };
}

function storageClient(urlName, keyName) {
  return createClient(required(urlName), required(keyName), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function integerAfter(name, fallback, minimum, maximum) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? fallback : Number.parseInt(process.argv[index + 1] ?? "", 10);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name.replace(/^--/, "").replaceAll("-", "_").toUpperCase()}_INVALID`);
  }
  return value;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_MISSING`);
  return value;
}

function safeReason(error) {
  const message = error instanceof Error ? error.message : "UNKNOWN";
  return /^[A-Z0-9_]+$/.test(message) ? message : "STORAGE_CANARY_FAILED";
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
