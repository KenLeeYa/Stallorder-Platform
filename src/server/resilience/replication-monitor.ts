import "server-only";

import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { logEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { getDrPrismaClient } from "@/server/resilience/database-targets";

type SubscriptionRow = {
  pid: number | null;
  received_lsn: string | null;
  replay_lsn: string | null;
  lag_seconds: number | null;
};

type MigrationRow = { version: string };
type SlotRow = { retained_bytes: bigint | null };

export function classifyReplicationObservation(input: {
  subscriptionPresent: boolean;
  workerPid: number | null;
  lagSeconds: number | null;
  schemaCompatible: boolean;
}) {
  if (!input.subscriptionPresent || input.workerPid === null) return "DISCONNECTED" as const;
  if (!input.schemaCompatible || input.lagSeconds === null || input.lagSeconds > 30) {
    return "DEGRADED" as const;
  }
  return "CONNECTED" as const;
}

function migrationDigest(rows: MigrationRow[]) {
  return createHash("sha256")
    .update(rows.map((row) => row.version).sort().join("\n"))
    .digest("hex");
}

async function readMigrationDigest(database: PrismaClient) {
  const rows = await database.$queryRaw<MigrationRow[]>(Prisma.sql`
    select version::text
    from supabase_migrations.schema_migrations
    order by version
  `);
  return migrationDigest(rows);
}

async function readSubscription(
  database: PrismaClient,
  subscriptionName: string,
) {
  const rows = await database.$queryRaw<SubscriptionRow[]>(Prisma.sql`
    select
      pid,
      received_lsn::text,
      latest_end_lsn::text as replay_lsn,
      case
        when latest_end_time is null then null
        else greatest(0, extract(epoch from (clock_timestamp() - latest_end_time)))
      end::double precision as lag_seconds
    from pg_catalog.pg_stat_subscription
    where subname = ${subscriptionName}
    limit 1
  `);
  return rows[0] ?? null;
}

async function readRetainedWalBytes(slotName: string) {
  const rows = await prisma.$queryRaw<SlotRow[]>(Prisma.sql`
    select
      case
        when restart_lsn is null then null
        else pg_catalog.pg_wal_lsn_diff(pg_catalog.pg_current_wal_lsn(), restart_lsn)::bigint
      end as retained_bytes
    from pg_catalog.pg_replication_slots
    where slot_name = ${slotName}
    limit 1
  `);
  return rows[0]?.retained_bytes ?? null;
}

export async function captureReplicationHealthSnapshot() {
  const dr = getDrPrismaClient();
  const subscriptionName = process.env.DR_REPLICATION_SUBSCRIPTION_NAME?.trim();
  const slotName = process.env.PRIMARY_REPLICATION_SLOT_NAME?.trim();
  if (!dr || !subscriptionName) {
    return prisma.replicationHealthSnapshot.create({
      data: {
        sourceBackendCode: "PRIMARY",
        targetBackendCode: "DR",
        status: "UNKNOWN",
        schemaCompatible: false,
        storageMirrorHealthy: false,
        lastErrorCode: dr ? "SUBSCRIPTION_NOT_CONFIGURED" : "DR_NOT_CONFIGURED",
      },
    });
  }

  try {
    const [primaryDigest, drDigest, subscription, slotWalBytes] = await Promise.all([
      readMigrationDigest(prisma),
      readMigrationDigest(dr),
      readSubscription(dr, subscriptionName),
      slotName ? readRetainedWalBytes(slotName) : Promise.resolve(null),
    ]);
    const schemaCompatible = primaryDigest === drDigest;
    const lagSeconds = subscription?.lag_seconds ?? null;
    const status = classifyReplicationObservation({
      subscriptionPresent: Boolean(subscription),
      workerPid: subscription?.pid ?? null,
      lagSeconds,
      schemaCompatible,
    });
    const pendingStorage = await prisma.storageObjectManifest.count({
      where: { replicationStatus: { in: ["PENDING", "PROCESSING", "FAILED"] } },
    });
    const snapshot = await prisma.replicationHealthSnapshot.create({
      data: {
        sourceBackendCode: "PRIMARY",
        targetBackendCode: "DR",
        status,
        lagSeconds,
        slotWalBytes,
        receivedLsn: subscription?.received_lsn ?? null,
        replayLsn: subscription?.replay_lsn ?? null,
        schemaCompatible,
        storageMirrorHealthy: pendingStorage === 0,
        lastErrorCode: status === "CONNECTED" ? null : "REPLICATION_NOT_READY",
      },
    });
    logEvent(status === "CONNECTED" ? "info" : "warn", "REPLICATION_HEALTH_CAPTURED", {
      status,
      lagSeconds,
      schemaCompatible,
      storageMirrorHealthy: pendingStorage === 0,
    });
    return snapshot;
  } catch {
    logEvent("error", "REPLICATION_HEALTH_CAPTURE_FAILED", {
      reason: "PROBE_FAILED",
    });
    return prisma.replicationHealthSnapshot.create({
      data: {
        sourceBackendCode: "PRIMARY",
        targetBackendCode: "DR",
        status: "DISCONNECTED",
        schemaCompatible: false,
        storageMirrorHealthy: false,
        lastErrorCode: "PROBE_FAILED",
      },
    });
  }
}
