import { PrismaClient } from "@prisma/client";
import {
  readRuntimeState,
  transitionRuntime,
} from "./lib/dr-failover-operations.mjs";
import {
  environmentLocalTables,
  replicatedPublicTables,
} from "./lib/dr-replication-scope.mjs";

const expectedCronJobNames = new Set([
  "invoke-vercel-preview-process-orders",
  "stallorder-billing-invoice-overdue",
  "stallorder-billing-trial-expiration",
  "stallorder-cash-shift-alerts",
  "stallorder-expire-merchant-applications",
  "stallorder-expire-unconfirmed-orders",
  "stallorder-line-link-session-cleanup",
  "stallorder-notification-jobs",
  "stallorder-report-deliveries",
  "stallorder-stall-schedules",
]);

const primary = new PrismaClient({
  datasources: { db: { url: requiredPostgresUrl("DIRECT_URL") } },
});
const dr = new PrismaClient({
  datasources: { db: { url: requiredPostgresUrl("DR_DIRECT_URL") } },
});

try {
  requireApproval();
  const actorEmail = required("FAILOVER_ACTOR_EMAIL").toLowerCase();
  const replicationPassword = required("PRIMARY_REPLICATION_PASSWORD");
  if (!/^[a-f0-9]{64}$/i.test(replicationPassword)) {
    throw new Error("PRIMARY_REPLICATION_PASSWORD_INVALID");
  }

  const [
    activeOrders,
    activeSessions,
    drBusinessRows,
    drStorageObjects,
    actors,
  ] = await Promise.all([
    primary.$queryRawUnsafe(
      `select count(*)::integer as count
       from public.orders
       where status in (
         'WAITING_CONFIRMATION',
         'CONFIRMED',
         'PREPARING',
         'PACKING',
         'READY'
       )`,
    ),
    primary.$queryRawUnsafe(
      `select count(*)::integer as count
       from public.order_sessions
       where status = 'ACTIVE'
         and used_at is null
         and revoked_at is null
         and expires_at > now()`,
    ),
    dr.$queryRawUnsafe(
      `select
         (select count(*) from public.organizations)::integer as organizations,
         (select count(*) from public.profiles)::integer as profiles,
         (select count(*) from public.stalls)::integer as stalls,
         (select count(*) from public.orders)::integer as orders`,
    ),
    dr.$queryRawUnsafe(
      "select count(*)::integer as count from storage.objects",
    ),
    primary.$queryRawUnsafe(
      `select id
       from public.profiles
       where lower(email) = $1
         and is_active
         and platform_role = 'PLATFORM_ADMIN'
       limit 1`,
      actorEmail,
    ),
  ]);

  if (activeOrders[0]?.count !== 0) throw new Error("PRIMARY_ACTIVE_ORDERS_PRESENT");
  if (activeSessions[0]?.count !== 0) throw new Error("PRIMARY_ACTIVE_SESSIONS_PRESENT");
  if (!actors[0]?.id) throw new Error("FAILOVER_ACTOR_NOT_AUTHORIZED");
  if (Object.values(drBusinessRows[0] ?? {}).some((count) => Number(count) !== 0)) {
    throw new Error("DR_BUSINESS_DATA_NOT_EMPTY");
  }
  if (drStorageObjects[0]?.count !== 0) {
    throw new Error("DR_STORAGE_OBJECTS_PRESENT");
  }

  await dr.$executeRawUnsafe("delete from auth.users");
  const activeCronJobs = await dr.$queryRawUnsafe(
    "select jobid::text as job_id, jobname from cron.job where active order by jobid",
  );
  const unexpectedCronJobs = activeCronJobs.filter(
    (job) => !expectedCronJobNames.has(job.jobname),
  );
  if (unexpectedCronJobs.length > 0) {
    throw new Error("DR_UNKNOWN_ACTIVE_CRON_JOBS");
  }
  for (const job of activeCronJobs) {
    await dr.$executeRawUnsafe(
      "select cron.alter_job($1::bigint, active := false)",
      job.job_id,
    );
  }
  const remainingActiveCronJobs = await dr.$queryRawUnsafe(
    "select count(*)::integer as count from cron.job where active",
  );
  if (remainingActiveCronJobs[0]?.count !== 0) {
    throw new Error("DR_ACTIVE_CRON_JOBS_REMAIN");
  }
  const disabledCronJobs = activeCronJobs.length;
  const clearedTables = [...replicatedPublicTables, ...environmentLocalTables];
  const replicatedTableList = clearedTables
    .map((table) => `"public"."${table.replaceAll('"', '""')}"`)
    .join(", ");
  await dr.$executeRawUnsafe(
    `truncate table ${replicatedTableList} restart identity cascade`,
  );
  await dr.$executeRawUnsafe(
    `insert into public.backend_runtime_state (
       backend_code,
       backend_role,
       region,
       promotion_epoch,
       writes_enabled,
       enforcement_enabled,
       is_current,
       promoted_at,
       reason
     )
     values
       (
         'PRIMARY',
         'ACTIVE_WRITER',
         'ap-northeast-1',
         1,
         true,
         false,
         true,
         now(),
         'Recreated before approved conversion of this project into the Production DR standby.'
       ),
       (
         'DR',
         'READ_ONLY_STANDBY',
         'ap-northeast-1',
         1,
         false,
         false,
         false,
         null,
         'Recreated DR standby definition before approved Production DR initialization.'
       )`,
  );

  const [primaryBefore, drBefore] = await Promise.all([
    readRuntimeState(primary),
    readRuntimeState(dr),
  ]);
  const actorProfileId = actors[0].id;

  if (
    primaryBefore.backendCode === "PRIMARY"
    && primaryBefore.backendRole === "ACTIVE_WRITER"
    && primaryBefore.writesEnabled
    && !primaryBefore.enforcementEnabled
  ) {
    await transitionRuntime(primary, {
      expectedBackendCode: "PRIMARY",
      expectedPromotionEpoch: primaryBefore.promotionEpoch,
      targetBackendCode: "PRIMARY",
      targetBackendRole: "ACTIVE_WRITER",
      targetPromotionEpoch: primaryBefore.promotionEpoch,
      reason: "Enable reviewed Production Primary writer fencing before DR replication.",
      actorProfileId,
    });
  } else if (
    primaryBefore.backendCode !== "PRIMARY"
    || primaryBefore.backendRole !== "ACTIVE_WRITER"
    || !primaryBefore.writesEnabled
    || !primaryBefore.enforcementEnabled
  ) {
    throw new Error("PRIMARY_RUNTIME_STATE_UNEXPECTED");
  }

  if (
    drBefore.backendCode === "PRIMARY"
    && drBefore.backendRole === "ACTIVE_WRITER"
    && drBefore.writesEnabled
    && !drBefore.enforcementEnabled
  ) {
    await transitionRuntime(dr, {
      expectedBackendCode: "PRIMARY",
      expectedPromotionEpoch: drBefore.promotionEpoch,
      targetBackendCode: "DR",
      targetBackendRole: "READ_ONLY_STANDBY",
      targetPromotionEpoch: drBefore.promotionEpoch,
      reason: "Convert the former Staging project into the reviewed Production DR standby.",
      actorProfileId: null,
    });
  } else if (
    drBefore.backendCode !== "DR"
    || drBefore.backendRole !== "READ_ONLY_STANDBY"
    || drBefore.writesEnabled
    || !drBefore.enforcementEnabled
  ) {
    throw new Error("DR_RUNTIME_STATE_UNEXPECTED");
  }

  const quotedPassword = quoteLiteral(replicationPassword);
  await primary.$executeRawUnsafe(
    `do $$
     begin
       if not exists (
         select 1 from pg_catalog.pg_roles where rolname = 'stallorder_replication'
       ) then
         create role stallorder_replication;
       end if;
     end
     $$`,
  );
  await primary.$executeRawUnsafe(
    `alter role stallorder_replication
       with login replication bypassrls connection limit 4 password ${quotedPassword}`,
  );
  await primary.$executeRawUnsafe(
    "grant connect on database postgres to stallorder_replication",
  );
  await primary.$executeRawUnsafe(
    "grant usage on schema public to stallorder_replication",
  );
  await primary.$executeRawUnsafe(
    "grant select on all tables in schema public to stallorder_replication",
  );
  await primary.$executeRawUnsafe(
    `alter default privileges for role postgres in schema public
       grant select on tables to stallorder_replication`,
  );
  const replicationRoles = await primary.$queryRawUnsafe(
    `select
       rolcanlogin,
       rolreplication,
       rolbypassrls,
       rolsuper,
       rolconnlimit
     from pg_catalog.pg_roles
     where rolname = 'stallorder_replication'`,
  );
  const replicationRole = replicationRoles[0];
  if (
    replicationRole?.rolcanlogin !== true
    || replicationRole.rolreplication !== true
    || replicationRole.rolbypassrls !== true
    || replicationRole.rolsuper !== false
    || replicationRole.rolconnlimit !== 4
  ) {
    throw new Error("REPLICATION_ROLE_NOT_READY");
  }

  const updated = await primary.$executeRawUnsafe(
    `update public.resilience_feature_flag_overrides override
     set
       enabled = true,
       expires_at = now() + interval '12 hours',
       reason = 'Approved Production DR creation and measured failover window.',
       updated_by_profile_id = $1::uuid,
       updated_at = now()
     from public.resilience_feature_flags flag
     where override.flag_id = flag.id
       and flag.code = 'DR_FAILOVER_ENABLED'
       and override.scope_type = 'GLOBAL'
       and override.organization_id is null
       and override.stall_id is null
       and override.device_id is null`,
    actorProfileId,
  );
  if (updated === 0) {
    await primary.$executeRawUnsafe(
      `insert into public.resilience_feature_flag_overrides (
         flag_id,
         scope_type,
         enabled,
         expires_at,
         reason,
         created_by_profile_id,
         updated_by_profile_id
       )
       select
         id,
         'GLOBAL',
         true,
         now() + interval '12 hours',
         'Approved Production DR creation and measured failover window.',
         $1::uuid,
         $1::uuid
       from public.resilience_feature_flags
       where code = 'DR_FAILOVER_ENABLED'`,
      actorProfileId,
    );
  }

  const [primaryAfter, drAfter] = await Promise.all([
    readRuntimeState(primary),
    readRuntimeState(dr),
  ]);
  console.log(JSON.stringify({
    event: "production_dr_initialized",
    actorProfileId,
    primary: primaryAfter,
    dr: drAfter,
    activeOrders: 0,
    activeSessions: 0,
    storageObjects: 0,
    disabledCronJobs,
    clearedReplicatedTables: replicatedPublicTables.length,
    clearedEnvironmentLocalTables: environmentLocalTables.length,
    replicationRoleReady: true,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    event: "production_dr_initialization_failed",
    reason: error instanceof Error ? error.message : "UNKNOWN",
  }));
  process.exitCode = 1;
} finally {
  await Promise.allSettled([primary.$disconnect(), dr.$disconnect()]);
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

function requireApproval() {
  if (process.env.PRODUCTION_ENVIRONMENT_APPROVED !== "true") {
    throw new Error("PRODUCTION_ENVIRONMENT_NOT_APPROVED");
  }
  if (process.env.DR_CHANGE_CONFIRMATION !== "INITIALIZE_PRODUCTION_DR") {
    throw new Error("CONFIRMATION_REQUIRED_INITIALIZE_PRODUCTION_DR");
  }
}

function quoteLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}
