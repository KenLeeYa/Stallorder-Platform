import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

export function assertIsolatedStorageQa(input: {
  ref: string; parentRef: string; supabaseUrl: string; databaseUrl: string;
}) {
  const database = new URL(input.databaseUrl);
  if (!/^[a-z]{20}$/.test(input.ref) || !input.parentRef
    || [input.parentRef, "eyuctbnlvnbnivwasvqr", "daeqwtpaxcebmtwxqdkj"].includes(input.ref)
    || input.supabaseUrl !== `https://${input.ref}.supabase.co`
    || !["postgres:", "postgresql:"].includes(database.protocol)
    || database.pathname !== "/postgres" || database.searchParams.has("hostaddr")
    || database.searchParams.has("host")
    || !((database.hostname.endsWith(".pooler.supabase.com")
      && database.username === `postgres.${input.ref}`)
      || (database.hostname === `db.${input.ref}.supabase.co` && database.username === "postgres"))) {
    throw new Error("STORAGE_QA_TARGET_INVALID");
  }
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.VERCEL_ENV !== "preview"
    || process.env.GITHUB_REPOSITORY !== "KenLeeYa/Stallorder-Platform") {
    throw new Error("STORAGE_QA_INVOCATION_INVALID");
  }
  const ref = required("STORAGE_QA_BRANCH_REF");
  const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL");
  assertIsolatedStorageQa({ ref, supabaseUrl, parentRef: required("SUPABASE_PARENT_PROJECT_REF"),
    databaseUrl: required("DATABASE_URL") });
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys`, {
    headers: { Authorization: `Bearer ${required("SUPABASE_ACCESS_TOKEN")}` },
    redirect: "error", signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("STORAGE_QA_KEY_LOOKUP_FAILED");
  const keys = await response.json() as Array<{ name: string; api_key: string }>;
  const key = keys.find((entry) => entry.name === "service_role")?.api_key;
  if (!key) throw new Error("STORAGE_QA_SERVICE_KEY_MISSING");
  console.log("Storage QA: isolated target and temporary service access verified.");
  // The isolated key is used only by this process, never exported to later steps.
  process.env.PRIMARY_SUPABASE_URL = supabaseUrl;
  process.env.PRIMARY_SUPABASE_SECRET_KEY = key;
  process.env.DR_SUPABASE_URL = "";
  process.env.DR_SUPABASE_SECRET_KEY = "";
  process.env.DR_SUPABASE_SERVICE_ROLE_KEY = "";
  const { prisma } = await import("../src/lib/prisma");
  const { publishImmutableStorageObject, enqueueStorageDeletion, processStorageReplicationJobs } =
    await import("../src/server/resilience/storage-replication-service");
  const storage = createClient(supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage.from("product-images");
  const objectPath = `qa-storage-retirement/${randomUUID()}.png`;
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY9kAAAAASUVORK5CYII=", "base64");
  let uploaded = false;
  let manifestId: string | null = null;
  try {
    assert.equal(await prisma.storageReplicationJob.count({
      where: { status: { in: ["PENDING", "PROCESSING", "FAILED"] } },
    }), 0, "STORAGE_QA_QUEUE_NOT_EMPTY");
    const published = await publishImmutableStorageObject({ organizationId: null,
      bucket: "product-images", objectPath, contentType: "image/png", bytes });
    uploaded = true;
    assert.equal(await prisma.storageObjectManifest.findUnique({
      where: { bucket_objectPath: { bucket: "product-images", objectPath } },
    }), null, "STORAGE_QA_UNEXPECTED_REPLICA");
    const downloaded = await storage.download(objectPath);
    assert.equal(downloaded.error, null, "STORAGE_QA_DOWNLOAD_FAILED");
    assert.deepEqual(Buffer.from(await downloaded.data!.arrayBuffer()), bytes);
    console.log("Storage QA: real upload/read passed without a new replica.");

    const oldManifest = await prisma.storageObjectManifest.create({ data: {
      bucket: "product-images", objectPath, contentType: "image/png",
      primaryChecksum: published.checksum, primaryUpdatedAt: new Date(),
    } });
    manifestId = oldManifest.id;
    const oldJob = await prisma.storageReplicationJob.create({ data: {
      manifestId, sourceBackendCode: "PRIMARY", targetBackendCode: "DR",
    } });
    assert.equal((await processStorageReplicationJobs()).cancelled, 1);
    assert.equal((await prisma.storageReplicationJob.findUniqueOrThrow({
      where: { id: oldJob.id },
    })).status, "CANCELLED");
    assert.equal((await storage.download(objectPath)).error, null);
    console.log("Storage QA: old replica cancelled; source file retained.");

    await enqueueStorageDeletion({ organizationId: null, bucket: "product-images",
      objectPath, contentType: "image/png" });
    assert.equal((await processStorageReplicationJobs()).deleted, 1);
    const tombstone = await prisma.storageObjectManifest.findUniqueOrThrow({ where: { id: manifestId } });
    assert.equal(tombstone.replicationStatus, "DELETED");
    assert.equal(tombstone.drChecksum, null);
    const removed = await storage.download(objectPath);
    assert.ok(removed.error, "STORAGE_QA_OBJECT_NOT_REMOVED");
    const remaining = await storage.list("qa-storage-retirement", { search: objectPath.split("/")[1] });
    assert.equal(remaining.error, null, "STORAGE_QA_LIST_FAILED");
    assert.equal(remaining.data!.length, 0, "STORAGE_QA_OBJECT_STILL_LISTED");
    console.log("PASS: isolated live upload/read, retired-replica cancellation and Primary-only deletion.");
  } finally {
    try {
      if (uploaded) {
        const cleanup = await storage.remove([objectPath]);
        assert.equal(cleanup.error, null, "STORAGE_QA_CLEANUP_FAILED");
      }
      if (manifestId) {
        await prisma.storageReplicationJob.deleteMany({ where: { manifestId } });
        await prisma.storageObjectManifest.delete({ where: { id: manifestId } });
      }
    } finally {
      await prisma.$disconnect();
    }
  }
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_MISSING`);
  return value;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => {
    // Provider exceptions can contain connection details: do not print them.
    console.error("STORAGE_RETIREMENT_LIVE_QA_FAILED");
    process.exitCode = 1;
  });
}
