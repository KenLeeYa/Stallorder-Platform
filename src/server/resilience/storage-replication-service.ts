import "server-only";

import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { logEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

const MAX_REPLICATION_ATTEMPTS = 5;
const MAX_OBJECT_BYTES = 6 * 1024 * 1024;

type StorageReplicationInput = {
  organizationId: string | null;
  bucket: string;
  objectPath: string;
  primaryChecksum: string;
  primaryUpdatedAt: Date;
};

function assertStorageObjectReference(bucket: string, objectPath: string) {
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
}

export function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function storageReplicationRetryDelayMs(attempt: number) {
  return Math.min(15 * 60_000, 15_000 * 2 ** Math.max(0, attempt - 1));
}

export async function enqueueStorageReplication(input: StorageReplicationInput) {
  assertStorageObjectReference(input.bucket, input.objectPath);
  if (!/^[a-f0-9]{64}$/.test(input.primaryChecksum)) {
    throw new Error("STORAGE_CHECKSUM_INVALID");
  }

  return prisma.$transaction(async (transaction) => {
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
        primaryChecksum: input.primaryChecksum,
        primaryUpdatedAt: input.primaryUpdatedAt,
        replicationStatus: "PENDING",
      },
      update: {
        organizationId: input.organizationId,
        primaryChecksum: input.primaryChecksum,
        primaryUpdatedAt: input.primaryUpdatedAt,
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

async function mirrorObject(
  primary: SupabaseClient,
  dr: SupabaseClient,
  bucket: string,
  objectPath: string,
  expectedChecksum: string,
) {
  const source = await downloadObject(primary, bucket, objectPath);
  const sourceChecksum = sha256Hex(source);
  if (sourceChecksum !== expectedChecksum) throw new Error("SOURCE_CHECKSUM_CHANGED");

  const upload = await dr.storage.from(bucket).upload(objectPath, source, {
    upsert: true,
    cacheControl: "31536000",
    contentType: "image/webp",
  });
  if (upload.error) throw new Error("TARGET_UPLOAD_FAILED");
  const mirrored = await downloadObject(dr, bucket, objectPath);
  const targetChecksum = sha256Hex(mirrored);
  if (targetChecksum !== sourceChecksum) throw new Error("TARGET_CHECKSUM_MISMATCH");
  return targetChecksum;
}

function safeReplicationErrorCode(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return [
    "SOURCE_DOWNLOAD_FAILED",
    "SOURCE_OBJECT_TOO_LARGE",
    "SOURCE_CHECKSUM_CHANGED",
    "TARGET_UPLOAD_FAILED",
    "TARGET_CHECKSUM_MISMATCH",
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
  const candidates = await prisma.storageReplicationJob.findMany({
    where: {
      status: { in: ["PENDING", "FAILED"] },
      attemptCount: { lt: MAX_REPLICATION_ATTEMPTS },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.min(limit, 50)),
    include: { manifest: true },
  });

  let mirrored = 0;
  let failed = 0;
  for (const candidate of candidates) {
    const claim = await prisma.storageReplicationJob.updateMany({
      where: {
        id: candidate.id,
        status: { in: ["PENDING", "FAILED"] },
        attemptCount: candidate.attemptCount,
      },
      data: {
        status: "PROCESSING",
        claimedAt: new Date(),
        attemptCount: { increment: 1 },
        lastErrorCode: null,
      },
    });
    if (claim.count !== 1) continue;

    try {
      if (!candidate.manifest.primaryChecksum) throw new Error("SOURCE_CHECKSUM_CHANGED");
      const drChecksum = await mirrorObject(
        clients.primary,
        clients.dr,
        candidate.manifest.bucket,
        candidate.manifest.objectPath,
        candidate.manifest.primaryChecksum,
      );
      await prisma.$transaction([
        prisma.storageReplicationJob.update({
          where: { id: candidate.id },
          data: {
            status: "MIRRORED",
            completedAt: new Date(),
            nextAttemptAt: null,
          },
        }),
        prisma.storageObjectManifest.update({
          where: { id: candidate.manifestId },
          data: {
            drChecksum,
            drUpdatedAt: new Date(),
            replicationStatus: "MIRRORED",
            retryCount: candidate.attemptCount + 1,
            lastErrorCode: null,
          },
        }),
      ]);
      mirrored += 1;
    } catch (error) {
      const attempt = candidate.attemptCount + 1;
      const errorCode = safeReplicationErrorCode(error);
      const exhausted = attempt >= MAX_REPLICATION_ATTEMPTS;
      await prisma.$transaction([
        prisma.storageReplicationJob.update({
          where: { id: candidate.id },
          data: {
            status: "FAILED",
            nextAttemptAt: exhausted
              ? null
              : new Date(Date.now() + storageReplicationRetryDelayMs(attempt)),
            lastErrorCode: errorCode,
          },
        }),
        prisma.storageObjectManifest.update({
          where: { id: candidate.manifestId },
          data: {
            replicationStatus: "FAILED",
            retryCount: attempt,
            lastErrorCode: errorCode,
          },
        }),
      ]);
      failed += 1;
      logEvent("warn", "STORAGE_REPLICATION_FAILED", {
        jobId: candidate.id,
        errorCode,
        attempt,
      });
    }
  }

  return {
    processed: mirrored + failed,
    mirrored,
    failed,
    status: "PROCESSED" as const,
  };
}
