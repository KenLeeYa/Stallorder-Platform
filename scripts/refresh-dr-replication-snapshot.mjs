import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { replicatedPublicTables } from "./lib/dr-replication-scope.mjs";

const subscriptionName = "stallorder_primary_to_dr";
const args = new Set(process.argv.slice(2));
const createCanary = args.has("--create-canary");
const drillId = valueAfter("--drill-id") ?? "bootstrap";
const waitSeconds = Number.parseInt(valueAfter("--wait-seconds") ?? "900", 10);
const primary = new PrismaClient({
  datasources: { db: { url: requiredPostgresUrl("DIRECT_URL") } },
});
const dr = new PrismaClient({
  datasources: { db: { url: requiredPostgresUrl("DR_DIRECT_URL") } },
});
let lastReplicationCheck = null;

try {
  if (!Number.isSafeInteger(waitSeconds) || waitSeconds < 10 || waitSeconds > 1800) {
    throw new Error("WAIT_SECONDS_INVALID");
  }
  const actorEmail = required("FAILOVER_ACTOR_EMAIL").toLowerCase();
  const actors = await primary.$queryRawUnsafe(
    `select id
     from public.profiles
     where lower(email) = $1
       and is_active
       and platform_role = 'PLATFORM_ADMIN'
     limit 1`,
    actorEmail,
  );
  if (!actors[0]?.id) throw new Error("FAILOVER_ACTOR_NOT_AUTHORIZED");

  let canary = null;
  if (createCanary) {
    const id = randomUUID();
    const requestId = randomUUID();
    const insertedAt = new Date();
    await primary.$executeRawUnsafe(
      `insert into public.audit_logs (
         id,
         actor_profile_id,
         action,
         entity_type,
         outcome,
         request_id,
         metadata
       )
       values (
         $1::uuid,
         $2::uuid,
         'DR_RPO_CANARY',
         'BACKEND',
         'SUCCESS',
         $3::text,
         $4::text
       )`,
      id,
      actors[0].id,
      requestId,
      JSON.stringify({ drillId }),
    );
    canary = { id, insertedAt };
  }

  const targetLsnRows = await primary.$queryRawUnsafe(
    "select pg_current_wal_lsn()::text as lsn",
  );
  const targetLsn = targetLsnRows[0]?.lsn;
  if (!targetLsn) throw new Error("PRIMARY_LSN_UNAVAILABLE");

  const deadline = Date.now() + waitSeconds * 1000;
  let status;
  let canarySeenAt = null;
  do {
    status = await readSubscriptionStatus();
    if (canary && !canarySeenAt) {
      const rows = await dr.$queryRawUnsafe(
        "select 1 from public.audit_logs where id = $1::uuid",
        canary.id,
      );
      if (rows.length === 1) canarySeenAt = new Date();
    }
    const lsnCaughtUp = status.replayLsn
      ? await isLsnCaughtUp(status.replayLsn, targetLsn)
      : false;
    const canaryCaughtUp = !canary || Boolean(canarySeenAt);
    lastReplicationCheck = {
      enabled: status.enabled,
      connected: status.connected,
      totalRelations: status.totalRelations,
      readyRelations: status.readyRelations,
      lsnCaughtUp,
      canaryCaughtUp,
    };
    if (
      status.enabled
      && status.connected
      && status.readyRelations === replicatedPublicTables.length
      && lsnCaughtUp
      && canaryCaughtUp
    ) {
      break;
    }
    await delay(2_000);
  } while (Date.now() < deadline);

  const lsnCaughtUp = status?.replayLsn
    ? await isLsnCaughtUp(status.replayLsn, targetLsn)
    : false;
  if (
    !status?.enabled
    || !status.connected
    || status.readyRelations !== replicatedPublicTables.length
    || !lsnCaughtUp
    || (canary && !canarySeenAt)
  ) {
    throw new Error("DR_REPLICATION_NOT_CAUGHT_UP");
  }

  const [migrationCompatible, coreCounts, storageCounts, slot] = await Promise.all([
    migrationDigestsMatch(),
    compareCoreCounts(),
    compareStorageCounts(),
    readPrimarySlot(),
  ]);
  if (!migrationCompatible) throw new Error("MIGRATION_HISTORY_MISMATCH");
  if (coreCounts.mismatches.length > 0) throw new Error("CORE_ROW_COUNT_MISMATCH");
  if (!storageCounts.equal) throw new Error("STORAGE_OBJECT_COUNT_MISMATCH");

  const canaryLagSeconds = canary && canarySeenAt
    ? Math.max(0, (canarySeenAt.getTime() - canary.insertedAt.getTime()) / 1000)
    : 0;
  await primary.$executeRawUnsafe(
    `insert into public.replication_health_snapshots (
       source_backend_code,
       target_backend_code,
       status,
       lag_seconds,
       slot_wal_bytes,
       received_lsn,
       replay_lsn,
       schema_compatible,
       storage_mirror_healthy,
       observed_at
     )
     values (
       'PRIMARY',
       'DR',
       'CONNECTED',
       $1::numeric,
       $2::bigint,
       $3::text,
       $4::text,
       true,
       true,
       now()
     )`,
    canaryLagSeconds,
    BigInt(slot.walBytes),
    status.receivedLsn,
    status.replayLsn,
  );

  console.log(JSON.stringify({
    event: "dr_replication_snapshot_refreshed",
    drillId,
    publicationTableCount: replicatedPublicTables.length,
    readyRelations: status.readyRelations,
    targetLsn,
    receivedLsn: status.receivedLsn,
    replayLsn: status.replayLsn,
    slotWalBytes: slot.walBytes,
    canaryReplicated: Boolean(canarySeenAt),
    canaryLagSeconds,
    coreCounts: coreCounts.counts,
    storageObjectCount: storageCounts.primary,
    storageManifestIssues: storageCounts.pendingOrInvalidManifests,
    schemaCompatible: migrationCompatible,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    event: "dr_replication_snapshot_failed",
    reason: error instanceof Error ? error.message : "UNKNOWN",
    replication: lastReplicationCheck,
  }));
  process.exitCode = 1;
} finally {
  await Promise.allSettled([primary.$disconnect(), dr.$disconnect()]);
}

async function readSubscriptionStatus() {
  const rows = await dr.$queryRawUnsafe(
    `select
       subscription.subenabled as enabled,
       stats.pid is not null as connected,
       stats.received_lsn::text as received_lsn,
       stats.latest_end_lsn::text as replay_lsn,
       (
         select count(*)::integer
         from pg_catalog.pg_subscription_rel relation
         where relation.srsubid = subscription.oid
       ) as total_relations,
       (
         select count(*)::integer
         from pg_catalog.pg_subscription_rel relation
         where relation.srsubid = subscription.oid
           and relation.srsubstate = 'r'
       ) as ready_relations
     from pg_catalog.pg_subscription subscription
     left join pg_catalog.pg_stat_subscription stats
       on stats.subid = subscription.oid
     where subscription.subname = $1
     limit 1`,
    subscriptionName,
  );
  const row = rows[0];
  return {
    enabled: row?.enabled === true,
    connected: row?.connected === true,
    receivedLsn: row?.received_lsn ?? null,
    replayLsn: row?.replay_lsn ?? null,
    totalRelations: Number(row?.total_relations ?? 0),
    readyRelations: Number(row?.ready_relations ?? 0),
  };
}

async function isLsnCaughtUp(replayLsn, targetLsn) {
  const rows = await primary.$queryRawUnsafe(
    "select pg_wal_lsn_diff($1::pg_lsn, $2::pg_lsn)::text as difference",
    replayLsn,
    targetLsn,
  );
  return BigInt(rows[0]?.difference ?? "-1") >= 0n;
}

async function migrationDigest(database) {
  const rows = await database.$queryRawUnsafe(
    `select version::text
     from supabase_migrations.schema_migrations
     order by version`,
  );
  return createHash("sha256")
    .update(rows.map((row) => row.version).join("\n"))
    .digest("hex");
}

async function migrationDigestsMatch() {
  const [primaryDigest, drDigest] = await Promise.all([
    migrationDigest(primary),
    migrationDigest(dr),
  ]);
  return primaryDigest === drDigest;
}

async function compareCoreCounts() {
  const tables = [
    "organizations",
    "profiles",
    "stalls",
    "products",
    "qr_codes",
    "orders",
    "order_items",
    "payments",
    "auth_sessions",
    "auth_identities",
    "profile_auth_identities",
    "organization_memberships",
    "stall_memberships",
    "resilience_feature_flag_overrides",
  ];
  const counts = {};
  const mismatches = [];
  for (const table of tables) {
    const [primaryRows, drRows] = await Promise.all([
      primary.$queryRawUnsafe(`select count(*)::integer as count from public.${table}`),
      dr.$queryRawUnsafe(`select count(*)::integer as count from public.${table}`),
    ]);
    const primaryCount = Number(primaryRows[0]?.count ?? -1);
    const drCount = Number(drRows[0]?.count ?? -1);
    counts[table] = primaryCount;
    if (primaryCount !== drCount) mismatches.push(table);
  }
  return { counts, mismatches };
}

async function compareStorageCounts() {
  const [primaryRows, drRows, manifestRows] = await Promise.all([
    primary.$queryRawUnsafe(
      "select bucket_id, name from storage.objects order by bucket_id, name",
    ),
    dr.$queryRawUnsafe(
      "select bucket_id, name from storage.objects order by bucket_id, name",
    ),
    primary.$queryRawUnsafe(
      `select count(*)::integer as count
       from public.storage_object_manifest
       where replication_status <> 'MIRRORED'
          or primary_checksum is null
          or dr_checksum is distinct from primary_checksum`,
    ),
  ]);
  const primaryCount = primaryRows.length;
  const drCount = drRows.length;
  const inventoryDigest = (rows) => createHash("sha256")
    .update(JSON.stringify(rows))
    .digest("hex");
  const pendingOrInvalidManifests = Number(manifestRows[0]?.count ?? -1);
  return {
    primary: primaryCount,
    dr: drCount,
    pendingOrInvalidManifests,
    equal: primaryCount === drCount
      && inventoryDigest(primaryRows) === inventoryDigest(drRows)
      && pendingOrInvalidManifests === 0,
  };
}

async function readPrimarySlot() {
  const rows = await primary.$queryRawUnsafe(
    `select
       coalesce(
         pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn),
         0
       )::text as wal_bytes
     from pg_catalog.pg_replication_slots
     where slot_name = $1
     limit 1`,
    subscriptionName,
  );
  if (!rows[0]) throw new Error("PRIMARY_REPLICATION_SLOT_MISSING");
  return { walBytes: rows[0].wal_bytes };
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_MISSING`);
  return value;
}

function requiredPostgresUrl(name) {
  const value = required(name);
  const parsed = new URL(value);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error(`${name}_INVALID`);
  }
  return value;
}

function valueAfter(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
