import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { enqueueStorageDeletion } from "@/server/resilience/storage-replication-service";

const CATALOG_IMAGE_BUCKET = "product-images";
const STAGED_UPLOAD_TTL_MS = 24 * 60 * 60_000;
const MAX_STAGED_UPLOADS_PER_ORGANIZATION = 20;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class CatalogImageQuotaError extends Error {
  constructor() {
    super("CATALOG_IMAGE_STAGED_QUOTA_EXCEEDED");
    this.name = "CatalogImageQuotaError";
  }
}

export class CatalogImageLeaseError extends Error {
  constructor() {
    super("CATALOG_IMAGE_LEASE_INVALID");
    this.name = "CatalogImageLeaseError";
  }
}

export async function reserveCatalogImageUpload(organizationId: string, objectPath: string) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + STAGED_UPLOAD_TTL_MS);
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`
      select pg_advisory_xact_lock(hashtextextended(${`catalog-image:${organizationId}`}, 0))
    `;
    const activeCount = await transaction.catalogImageUpload.count({
      where: {
        organizationId,
        attachedAt: null,
        cleanupRequestedAt: null,
        expiresAt: { gt: now },
      },
    });
    if (activeCount >= MAX_STAGED_UPLOADS_PER_ORGANIZATION) {
      throw new CatalogImageQuotaError();
    }
    return transaction.catalogImageUpload.create({
      data: {
        organizationId,
        bucket: CATALOG_IMAGE_BUCKET,
        objectPath,
        expiresAt,
      },
      select: { id: true, expiresAt: true },
    });
  });
}

export async function expireCatalogImageUpload(organizationId: string, objectPath: string) {
  await prisma.catalogImageUpload.updateMany({
    where: {
      organizationId,
      bucket: CATALOG_IMAGE_BUCKET,
      objectPath,
      attachedAt: null,
    },
    data: { expiresAt: new Date(), cleanupRequestedAt: null },
  });
}

export async function attachCatalogImageUpload(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  imageUrl: string | null,
) {
  const objectPath = catalogImageObjectPath(imageUrl, organizationId);
  if (!objectPath) return;

  const now = new Date();
  const attached = await transaction.catalogImageUpload.updateMany({
    where: {
      organizationId,
      bucket: CATALOG_IMAGE_BUCKET,
      objectPath,
      attachedAt: null,
      cleanupRequestedAt: null,
      expiresAt: { gt: now },
    },
    data: { attachedAt: now },
  });
  if (attached.count === 1) return;

  const existing = await transaction.catalogImageUpload.findUnique({
    where: {
      bucket_objectPath: { bucket: CATALOG_IMAGE_BUCKET, objectPath },
    },
    select: { organizationId: true, attachedAt: true },
  });
  if (existing?.organizationId === organizationId && existing.attachedAt) return;
  throw new CatalogImageLeaseError();
}

export async function enqueueUnreferencedCatalogImageDeletion(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  imageUrl: string | null,
) {
  const objectPath = catalogImageObjectPath(imageUrl, organizationId);
  if (!objectPath) return false;

  const remainingReferences = await transaction.product.count({
    where: { organizationId, imageUrl },
  });
  if (remainingReferences > 0) return false;

  await enqueueStorageDeletion({
    organizationId,
    bucket: CATALOG_IMAGE_BUCKET,
    objectPath,
    contentType: "image/webp",
  }, transaction);
  await transaction.catalogImageUpload.updateMany({
    where: {
      organizationId,
      bucket: CATALOG_IMAGE_BUCKET,
      objectPath,
    },
    data: { cleanupRequestedAt: new Date() },
  });
  return true;
}

export async function claimExpiredCatalogImageUploads(limit = 20) {
  const candidates = await prisma.catalogImageUpload.findMany({
    where: {
      attachedAt: null,
      cleanupRequestedAt: null,
      expiresAt: { lte: new Date() },
    },
    orderBy: { expiresAt: "asc" },
    take: Math.max(1, Math.min(limit, 50)),
    select: {
      id: true,
      organizationId: true,
      bucket: true,
      objectPath: true,
    },
  });
  const claimed = [];
  for (const candidate of candidates) {
    const result = await prisma.catalogImageUpload.updateMany({
      where: { id: candidate.id, cleanupRequestedAt: null, attachedAt: null },
      data: { cleanupRequestedAt: new Date() },
    });
    if (result.count === 1) claimed.push(candidate);
  }
  return claimed;
}

export async function releaseCatalogImageCleanupClaim(id: string) {
  await prisma.catalogImageUpload.updateMany({
    where: { id, attachedAt: null },
    data: { cleanupRequestedAt: null },
  });
}

export function catalogImageObjectPath(imageUrl: string | null, organizationId: string) {
  if (!imageUrl) return null;
  try {
    const pathname = new URL(imageUrl, "http://stallorder.local").pathname;
    const prefix = "/api/assets/product-images/";
    if (!pathname.startsWith(prefix)) return null;
    const objectPath = decodeURIComponent(pathname.slice(prefix.length));
    const [candidateOrganizationId, filename, extra] = objectPath.split("/");
    if (extra || candidateOrganizationId !== organizationId) return null;
    if (!UUID_PATTERN.test(candidateOrganizationId) || !/^[0-9a-f-]{36}\.webp$/i.test(filename ?? "")) {
      return null;
    }
    return objectPath;
  } catch {
    return null;
  }
}
