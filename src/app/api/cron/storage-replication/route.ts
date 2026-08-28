import { safeEqual } from "@/lib/security";
import { prisma } from "@/lib/prisma";
import {
  claimExpiredCatalogImageUploads,
  releaseCatalogImageCleanupClaim,
} from "@/server/catalog/catalog-image-upload-service";
import {
  enqueueStorageDeletion,
  processStorageReplicationJobs,
} from "@/server/resilience/storage-replication-service";
import { processDueOperationalAlertRefreshes } from "@/server/operations/operational-alert-refresh-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization") ?? "";
  if (!secret) {
    return Response.json(
      { error: "CRON_NOT_CONFIGURED" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  if (!safeEqual(authorization, `Bearer ${secret}`)) {
    return Response.json(
      { error: "UNAUTHORIZED" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  const expired = await claimExpiredCatalogImageUploads(20);
  let cleanupQueued = 0;
  for (const upload of expired) {
    try {
      await enqueueStorageDeletion({
        organizationId: upload.organizationId,
        bucket: upload.bucket,
        objectPath: upload.objectPath,
        contentType: "image/webp",
      });
      cleanupQueued += 1;
    } catch {
      await releaseCatalogImageCleanupClaim(upload.id);
    }
  }
  const replication = await processStorageReplicationJobs(10);
  const operationalAlerts = await processDueOperationalAlertRefreshes(10);
  const attendanceEvidencePurged = await purgeExpiredAttendanceEvidence();
  return Response.json(
    { ...replication, expiredUploadsClaimed: expired.length, cleanupQueued, operationalAlerts, attendanceEvidencePurged },
    { headers: { "cache-control": "no-store" } },
  );
}

async function purgeExpiredAttendanceEvidence() {
  try {
    const rows = await prisma.$queryRaw<Array<{ purged: number }>>`
      select public.purge_expired_attendance_location_evidence(500) as purged
    `;
    return Number(rows[0]?.purged ?? 0);
  } catch {
    // Rolling deployments may briefly run before the additive attendance migration exists.
    return null;
  }
}
