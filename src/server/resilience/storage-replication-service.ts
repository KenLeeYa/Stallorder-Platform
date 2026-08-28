import "server-only";

import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { logEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

const MAX_REPLICATION_ATTEMPTS = 5;
const MAX_OBJECT_BYTES = 6 * 1024 * 1024;
const PROCESSING_LEASE_MS = 5 * 60_000;

type StorageReplicationInput = {
  organizationId: string | null;
  bucket: string;
  objectPath: string;
  contentType: string;
  primaryChecksum: string;
  primaryUpdatedAt: Date;
};

type StorageDeletionInput = {
  organizationId: string | null;
  bucket: string;
  objectPath: string;
  contentType: string;
};

function assertStorageObjectReference(bucket: string, objectPath: string, contentType: string) {
  if (!/^[a-z0-9][a-z0-9._-]{1,62}$/.test(bucket)) {
    throw new Error("STORAGE_BUCKET_INVALID");
  }
  if (
    objectPath.length < 1
    || objectPath.length > 1_024
    || /(^|\/)\.\.(\/|$)/.test(objectPath)
    || /[\u0000-\u001f\u007f]/.test(objectPath)
  ) {
    throw new Error("STORAGE_OBJECT_PATH_INVALID");
  }
  if (!/^[a-z0-9][a-z0-9.+-]+\/[a-z0-9][a-z0-9.+-]+$/.test(contentType)) {
    throw new Error("STORAGE_CONTENT_TYPE_INVALID");
  }
}

export function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function storageReplicationRetryDelayMs(attempt: number) {
  return Math.min(15 * 60_000, 15_000 * 2 ** Math.max(0, attempt - 1));
}

export async function enqueueStorageReplication(input: StorageReplicationInput) {
  assertStorageObjectReference(input.bucket, input.objectPath, input.contentType);
  if (!/^[a-f0-9]{64}$/.test(input.primaryChecksum)) {
    throw new Error("STORAGE_CHECKSUM_INVALID");
  }

  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.storageObjectManifest.findUnique({
      where: {
        bucket_objectPath: {
          bucket: input.bucket,
          objectPath: input.objectPath,
        },
      },
    });
    if (
      existing
      && !existing.deletedAt
      && existing.primaryChecksum === input.primaryChecksum
      && existing.contentType === input.contentType
      && ["PENDING", "PROCESSING", "MIRRORED"].includes(existing.replicationStatus)
    ) {
      return existing.id;
    }

    const manifest = await transaction.storageObjectManifest.upsert({
      where: {
        bucket_objectPath: {
          bucket: input.bucket,
          objectPath: input.objectPath,
        },
      },
      create: {
        organizationId: input.organizationId,
        bucket: input.bucket,
        objectPath: input.objectPath,
        contentType: input.contentType,
        primaryChecksum: input.primaryChecksum,
        primaryUpdatedAt: input.primaryUpdatedAt,
        replicationStatus: "PENDING",
      },
      update: {
        organizationId: input.organizationId,
        contentType: input.contentType,
        primaryChecksum: input.primaryChecksum,
        primaryUpdatedAt: input.primaryUpdatedAt,
        deletedAt: null,
        replicationStatus: "PENDING",
        retryCount: 0,
        lastErrorCode: null,
      },
    });
    await transaction.storageReplicationJob.updateMany({
      where: {
        manifestId: manifest.id,
        status: { in: ["PENDING", "PROCESSING", "FAILED"] },
      },
      data: {
        status: "CANCELLED",
        completedAt: new Date(),
        lastErrorCode: "SUPERSEDED",
      },
    });
    await transaction.storageReplicationJob.create({
      data: {
        manifestId: manifest.id,
        sourceBackendCode: "PRIMARY",
        targetBackendCode: "DR",
      },
    });
    return manifest.id;
  });
}

export async function enqueueStorageDeletion(
  input: StorageDeletionInput,
  transaction?: Prisma.TransactionClient,
) {
  assertStorageObjectReference(input.bucket, input.objectPath, input.contentType);
  if (transaction) return enqueueStorageDeletionWithTransaction(transaction, input);
  return prisma.$transaction((currentTransaction) => (
    enqueueStorageDeletionWithTransaction(currentTransaction, input)
  ));
}

async function enqueueStorageDeletionWithTransaction(
  transaction: Prisma.TransactionClient,
  input: StorageDeletionInput,
) {
  const existing = await transaction.storageObjectManifest.findUnique({
    where: {
      bucket_objectPath: { bucket: input.bucket, objectPath: input.objectPath },
    },
  });
  if (existing?.deletedAt && ["PENDING", "PROCESSING", "DELETED"].includes(existing.replicationStatus)) {
    return existing.id;
  }

  const deletedAt = new Date();
  const manifest = await transaction.storageObjectManifest.upsert({
    where: {
      bucket_objectPath: { bucket: input.bucket, objectPath: input.objectPath },
    },
    create: {
      organizationId: input.organizationId,
      bucket: input.bucket,
      objectPath: input.objectPath,
      contentType: input.contentType,
      deletedAt,
      replicationStatus: "PENDING",
    },
    update: {
      organizationId: input.organizationId,
      contentType: input.contentType,
      deletedAt,
      replicationStatus: "PENDING",
      retryCount: 0,
      lastErrorCode: null,
    },
  });
  await transaction.storageReplicationJob.updateMany({
    where: {
      manifestId: manifest.id,
      status: { in: ["PENDING", "PROCESSING", "FAILED"] },
    },
    data: {
      status: "CANCELLED",
      completedAt: deletedAt,
      lastErrorCode: "SUPERSEDED_BY_DELETE",
    },
  });
  await transaction.storageReplicationJob.create({
    data: {
      manifestId: manifest.id,
      sourceBackendCode: "PRIMARY",
      targetBackendCode: "DR",
    },
  });
  return manifest.id;
}

function storageAdmin(url: string | undefined, secret: string | undefined) {
  if (!url?.trim() || !secret?.trim()) return null;
  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function storageClients() {
  return {
    primary: storageAdmin(
      process.env.PRIMARY_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.PRIMARY_SUPABASE_SECRET_KEY
        ?? process.env.PRIMARY_SUPABASE_SERVICE_ROLE_KEY
        ?? process.env.SUPABASE_SECRET_KEY,
    ),
    dr: storageAdmin(
      process.env.DR_SUPABASE_URL,
      process.env.DR_SUPABASE_SECRET_KEY ?? process.env.DR_SUPABASE_SERVICE_ROLE_KEY,
    ),
  };
}

async function downloadObject(client: SupabaseClient, bucket: string, objectPath: string) {
  const result = await client.storage.from(bucket).download(objectPath);
  if (result.error || !result.data) throw new Error("SOURCE_DOWNLOAD_FAILED");
  if (result.data.size > MAX_OBJECT_BYTES) throw new Error("SOURCE_OBJECT_TOO_LARGE");
  return new Uint8Array(await result.data.arrayBuffer());
}

export async function publishImmutableStorageObject(input: {
  organizationId: string | null;
  bucket: string;
  objectPath: string;
  contentType: string;
  bytes: Uint8Array;
}) {
  assertStorageObjectReference(input.bucket, input.objectPath, input.contentType);
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_OBJECT_BYTES) {
    throw new Error("SOURCE_OBJECT_TOO_LARGE");
  }

  const { primary } = storageClients();
  if (!primary) throw new Error("PRIMARY_STORAGE_NOT_CONFIGURED");
  const checksum = sha256Hex(input.bytes);
  const upload = await primary.storage.from(input.bucket).upload(
    input.objectPath,
    input.bytes,
    {
      upsert: false,
      cacheControl: "31536000",
      contentType: input.contentType,
    },
  );

  if (upload.error) {
    const existing = await downloadObject(primary, input.bucket, input.objectPath);
    if (sha256Hex(existing) !== checksum) {
      throw new Error("IMMUTABLE_OBJECT_COLLISION");
    }
  }

  await enqueueStorageReplication({
    organizationId: input.organizationId,
    bucket: input.bucket,
    objectPath: input.objectPath,
    contentType: input.contentType,
    primaryChecksum: checksum,
    primaryUpdatedAt: new Date(),
  });
  return { checksum, objectPath: input.objectPath };
}

async function mirrorObject(
  primary: SupabaseClient,
  dr: SupabaseClient,
  bucket: string,
  objectPath: string,
  contentType: string,
  expectedChecksum: string,
) {
  const source = await downloadObject(primary, bucket, objectPath);
  const sourceChecksum = sha256Hex(source);
  if (sourceChecksum !== expectedChecksum) throw new Error("SOURCE_CHECKSUM_CHANGED");

  const upload = await dr.storage.from(bucket).upload(objectPath, source, {
    upsert: true,
    cacheControl: "31536000",
    contentType,
  });
  if (upload.error) throw new Error("TARGET_UPLOAD_FAILED");
  const mirrored = await downloadObject(dr, bucket, objectPath);
  const targetChecksum = sha256Hex(mirrored);
  if (targetChecksum !== sourceChecksum) throw new Error("TARGET_CHECKSUM_MISMATCH");
  return targetChecksum;
}

async function deleteObject(
  client: SupabaseClient,
  bucket: string,
  objectPath: string,
  errorCode: "PRIMARY_DELETE_FAILED" | "DR_DELETE_FAILED",
) {
  const result = await client.storage.from(bucket).remove([objectPath]);
  if (result.error) throw new Error(errorCode);
}

function safeReplicationErrorCode(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return [
    "SOURCE_DOWNLOAD_FAILED",
    "SOURCE_OBJECT_TOO_LARGE",
    "SOURCE_CHECKSUM_CHANGED",
    "TARGET_UPLOAD_FAILED",
    "TARGET_CHECKSUM_MISMATCH",
    "PRIMARY_DELETE_FAILED",
    "DR_DELETE_FAILED",
  ].includes(code)
    ? code
    : "STORAGE_REPLICATION_FAILED";
}

export async function processStorageReplicationJobs(limit = 10) {
  const clients = storageClients();
  if (!clients.primary || !clients.dr) {
    return { processed: 0, mirrored: 0, failed: 0, status: "NOT_CONFIGURED" as const };
  }

  const now = new Date();
  const staleBefore = new Date(now.getTime() - PROCESSING_LEASE_MS);
  const candidates = await prisma.storageReplicationJob.findMany({
    where: {
      attemptCount: { lt: MAX_REPLICATION_ATTEMPTS },
      OR: [
        {
          status: { in: ["PENDING", "FAILED"] },
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        {
          status: "PROCESSING",
          claimedAt: { lte: staleBefore },
        },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.min(limit, 50)),
    include: { manifest: true },
  });

  let mirrored = 0;
  let deleted = 0;
  let failed = 0;
  for (const candidate of candidates) {
    const claimedAt = new Date();
    const claim = await prisma.storageReplicationJob.updateMany({
      where: {
        id: candidate.id,
        attemptCount: candidate.attemptCount,
        ...(candidate.status === "PROCESSING"
          ? { status: "PROCESSING" as const, claimedAt: candidate.claimedAt }
          : { status: { in: ["PENDING" as const, "FAILED" as const] } }),
      },
      data: {
        status: "PROCESSING",
        claimedAt,
        completedAt: null,
        attemptCount: { increment: 1 },
        lastErrorCode: null,
      },
    });
    if (claim.count !== 1) continue;

    try {
      const isDeletion = Boolean(candidate.manifest.deletedAt);
      let drChecksum: string | null = null;
      if (isDeletion) {
        await deleteObject(
          clients.primary,
          candidate.manifest.bucket,
          candidate.manifest.objectPath,
          "PRIMARY_DELETE_FAILED",
        );
        await deleteObject(
          clients.dr,
          candidate.manifest.bucket,
          candidate.manifest.objectPath,
          "DR_DELETE_FAILED",
        );
      } else {
        if (!candidate.manifest.primaryChecksum) throw new Error("SOURCE_CHECKSUM_CHANGED");
        drChecksum = await mirrorObject(
          clients.primary,
          clients.dr,
          candidate.manifest.bucket,
          candidate.manifest.objectPath,
          candidate.manifest.contentType,
          candidate.manifest.primaryChecksum,
        );
      }
      const committed = await prisma.$transaction(async (transaction) => {
        const job = await transaction.storageReplicationJob.updateMany({
          where: { id: candidate.id, status: "PROCESSING", claimedAt },
          data: {
            status: "MIRRORED",
            completedAt: new Date(),
            nextAttemptAt: null,
          },
        });
        if (job.count !== 1) return false;
        await transaction.storageObjectManifest.update({
          where: { id: candidate.manifestId },
          data: {
            drChecksum,
            drUpdatedAt: isDeletion ? null : new Date(),
            primaryChecksum: isDeletion ? null : undefined,
            primaryUpdatedAt: isDeletion ? null : undefined,
            replicationStatus: isDeletion ? "DELETED" : "MIRRORED",
            retryCount: candidate.attemptCount + 1,
            lastErrorCode: null,
          },
        });
        return true;
      });
      if (!committed) continue;
      if (isDeletion) deleted += 1;
      else mirrored += 1;
    } catch (error) {
      const attempt = candidate.attemptCount + 1;
      const errorCode = safeReplicationErrorCode(error);
      const exhausted = attempt >= MAX_REPLICATION_ATTEMPTS;
      const committed = await prisma.$transaction(async (transaction) => {
        const job = await transaction.storageReplicationJob.updateMany({
          where: { id: candidate.id, status: "PROCESSING", claimedAt },
          data: {
            status: "FAILED",
            nextAttemptAt: exhausted
              ? null
              : new Date(Date.now() + storageReplicationRetryDelayMs(attempt)),
            lastErrorCode: errorCode,
          },
        });
        if (job.count !== 1) return false;
        await transaction.storageObjectManifest.update({
          where: { id: candidate.manifestId },
          data: {
            replicationStatus: "FAILED",
            retryCount: attempt,
            lastErrorCode: errorCode,
          },
        });
        return true;
      });
      if (!committed) continue;
      failed += 1;
      logEvent("warn", "STORAGE_REPLICATION_FAILED", {
        jobId: candidate.id,
        errorCode,
        attempt,
      });
    }
  }

  return {
    processed: mirrored + deleted + failed,
    mirrored,
    deleted,
    failed,
    status: "PROCESSED" as const,
  };
}
