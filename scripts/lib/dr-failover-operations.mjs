import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { replicatedPublicTables } from "./dr-replication-scope.mjs";

const backendCodes = new Set(["PRIMARY", "DR"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class FailoverOperationError extends Error {
  constructor(code) {
    super(code);
    this.name = "FailoverOperationError";
    this.code = code;
  }
}

export function optionValue(name, argv = process.argv.slice(2)) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

export function hasOption(name, argv = process.argv.slice(2)) {
  return argv.includes(name);
}

export function requireTarget(argv = process.argv.slice(2), allowed = ["PRIMARY", "DR"]) {
  const target = optionValue("--target", argv)?.trim().toUpperCase();
  if (!target || !backendCodes.has(target) || !allowed.includes(target)) {
    throw new FailoverOperationError(`TARGET_MUST_BE_${allowed.join("_OR_")}`);
  }
  return target;
}

export function requireReason(argv = process.argv.slice(2)) {
  const reason = optionValue("--reason", argv)?.trim();
  if (!reason || reason.length < 10 || reason.length > 1000) {
    throw new FailoverOperationError("FAILOVER_REASON_INVALID");
  }
  return reason;
}

export function requireExpectedEpoch(argv = process.argv.slice(2)) {
  const raw = optionValue("--expected-epoch", argv);
  const epoch = Number.parseInt(raw ?? "", 10);
  if (!Number.isSafeInteger(epoch) || epoch < 1) {
    throw new FailoverOperationError("EXPECTED_PROMOTION_EPOCH_INVALID");
  }
  return epoch;
}

export function requireApplyApproval(action) {
  if (process.env.PRODUCTION_ENVIRONMENT_APPROVED !== "true") {
    throw new FailoverOperationError("PRODUCTION_ENVIRONMENT_NOT_APPROVED");
  }
  if (process.env.DR_CHANGE_CONFIRMATION !== action) {
    throw new FailoverOperationError(`CONFIRMATION_REQUIRED_${action}`);
  }
}

export function requireActors() {
  const requestedBy = process.env.FAILOVER_REQUESTED_BY_PROFILE_ID?.trim();
  const approvedBy = process.env.FAILOVER_APPROVED_BY_PROFILE_ID?.trim();
  if (!requestedBy || !uuidPattern.test(requestedBy)) {
    throw new FailoverOperationError("FAILOVER_REQUESTER_INVALID");
  }
  if (!approvedBy || !uuidPattern.test(approvedBy)) {
    throw new FailoverOperationError("FAILOVER_APPROVER_INVALID");
  }
  return { requestedBy, approvedBy };
}

function requiredPostgresUrl(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new FailoverOperationError(`${name}_MISSING`);
  try {
    const parsed = new URL(value);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error();
  } catch {
    throw new FailoverOperationError(`${name}_INVALID`);
  }
  return value;
}

export function createFailoverClients() {
  return {
    primary: new PrismaClient({
      datasources: { db: { url: requiredPostgresUrl("DIRECT_URL") } },
    }),
    dr: new PrismaClient({
      datasources: { db: { url: requiredPostgresUrl("DR_DIRECT_URL") } },
    }),
  };
}

export async function disconnectFailoverClients(clients) {
  await Promise.allSettled([clients.primary.$disconnect(), clients.dr.$disconnect()]);
}

export function safeJson(value) {
  return JSON.stringify(
    value,
    (_key, item) => typeof item === "bigint" ? item.toString() : item,
    2,
  );
}

export function safeFailure(error) {
  return error instanceof FailoverOperationError
    ? error.code
    : "FAILOVER_OPERATION_FAILED";
}

export function nextPromotionEpoch(...epochs) {
  const normalized = epochs.map((epoch) => Number(epoch));
  if (normalized.some((epoch) => !Number.isSafeInteger(epoch) || epoch < 1)) {
    throw new FailoverOperationError("PROMOTION_EPOCH_INVALID");
  }
  return Math.max(...normalized) + 1;
}

export function evaluateReadiness(checks) {
  const normalized = checks.map((check) => ({
    code: check.code,
    ready: check.ready === true,
    evidence: check.evidence ?? null,
  }));
  return {
    ready: normalized.every((check) => check.ready),
    blockers: normalized.filter((check) => !check.ready).map((check) => check.code),
    checks: normalized,
  };
}

export function buildRuntimeCutover(target, promotionEpoch) {
  if (!backendCodes.has(target)) throw new FailoverOperationError("BACKEND_TARGET_INVALID");
  if (!Number.isSafeInteger(promotionEpoch) || promotionEpoch < 1) {
    throw new FailoverOperationError("PROMOTION_EPOCH_INVALID");
  }
  return {
    target,
    promotionEpoch,
    nonSecretEnvironment: {
      BACKEND_ACTIVE_TARGET: target,
      AUTH_PROJECT_CODE: target,
      PROMOTION_EPOCH: String(promotionEpoch),
    },
    secretBindingsRequired: target === "DR"
      ? [
          "DATABASE_URL <- DR runtime pooler secret",
          "DIRECT_URL <- DR direct or session pooler secret",
          "SUPABASE_SECRET_KEY <- DR server secret",
          "NEXT_PUBLIC_SUPABASE_URL <- DR project URL",
          "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY <- DR publishable key",
          "NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL <- DR Functions URL",
          "PUBLIC_ORDER_FUNCTION_ORIGIN <- stable DR order-function origin",
        ]
      : [
          "DATABASE_URL <- Primary runtime pooler secret",
          "DIRECT_URL <- Primary direct or session pooler secret",
          "SUPABASE_SECRET_KEY <- Primary server secret",
          "NEXT_PUBLIC_SUPABASE_URL <- Primary project URL",
          "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY <- Primary publishable key",
          "NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL <- Primary Functions URL",
          "PUBLIC_ORDER_FUNCTION_ORIGIN <- stable Primary order-function origin",
        ],
  };
}

export async function readRuntimeState(database) {
  const rows = await database.$queryRawUnsafe(
    `select
       backend_code,
       backend_role,
       region,
       promotion_epoch::text,
       writes_enabled,
       enforcement_enabled,
       is_current
     from public.backend_runtime_state
     where is_current
     limit 1`,
  );
  const state = rows[0];
  if (!state) throw new FailoverOperationError("BACKEND_RUNTIME_STATE_MISSING");
  return {
    backendCode: state.backend_code,
    backendRole: state.backend_role,
    region: state.region,
    promotionEpoch: Number.parseInt(state.promotion_epoch, 10),
    writesEnabled: state.writes_enabled,
    enforcementEnabled: state.enforcement_enabled,
    isCurrent: state.is_current,
  };
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

async function probe(database) {
  try {
    await database.$queryRawUnsafe("select 1");
    return true;
  } catch {
    return false;
  }
}

async function readReplicationSnapshot(database) {
  const rows = await database.$queryRawUnsafe(
    `select
       status,
       lag_seconds::double precision,
       received_lsn,
       replay_lsn,
       schema_compatible,
       storage_mirror_healthy,
       observed_at
     from public.replication_health_snapshots
     where source_backend_code = 'PRIMARY'
       and target_backend_code = 'DR'
     order by observed_at desc
     limit 1`,
  );
  const snapshot = rows[0];
  return snapshot
    ? {
        status: snapshot.status,
        lagSeconds: snapshot.lag_seconds,
        receivedLsn: snapshot.received_lsn,
        replayLsn: snapshot.replay_lsn,
        schemaCompatible: snapshot.schema_compatible,
        storageMirrorHealthy: snapshot.storage_mirror_healthy,
        observedAt: new Date(snapshot.observed_at),
      }
    : null;
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function readSequenceBindings(database) {
  const tableList = replicatedPublicTables.map(quoteLiteral).join(", ");
  return database.$queryRawUnsafe(
    `select
       sequence_namespace.nspname as sequence_schema,
       sequence_class.relname as sequence_name,
       table_namespace.nspname as table_schema,
       table_class.relname as table_name,
       attribute.attname as column_name
     from pg_catalog.pg_class sequence_class
     join pg_catalog.pg_namespace sequence_namespace
       on sequence_namespace.oid = sequence_class.relnamespace
     join pg_catalog.pg_depend dependency
       on dependency.objid = sequence_class.oid
      and dependency.classid = 'pg_class'::regclass
      and dependency.refclassid = 'pg_class'::regclass
      and dependency.deptype in ('a', 'i')
     join pg_catalog.pg_class table_class
       on table_class.oid = dependency.refobjid
     join pg_catalog.pg_namespace table_namespace
       on table_namespace.oid = table_class.relnamespace
     join pg_catalog.pg_attribute attribute
       on attribute.attrelid = table_class.oid
      and attribute.attnum = dependency.refobjsubid
     where sequence_class.relkind = 'S'
       and table_namespace.nspname = 'public'
       and table_class.relname in (${tableList})
     order by table_class.relname, attribute.attname`,
  );
}

async function readMaximum(database, binding) {
  const rows = await database.$queryRawUnsafe(
    `select max(${quoteIdentifier(binding.column_name)})::text as maximum
     from ${quoteIdentifier(binding.table_schema)}.${quoteIdentifier(binding.table_name)}`,
  );
  return BigInt(rows[0]?.maximum ?? "0");
}

async function readSequenceValue(database, binding) {
  try {
    const rows = await database.$queryRawUnsafe(
      `select last_value::text as last_value
       from ${quoteIdentifier(binding.sequence_schema)}.${quoteIdentifier(binding.sequence_name)}`,
    );
    return BigInt(rows[0]?.last_value ?? "0");
  } catch {
    return null;
  }
}

export async function inspectSequenceSafety(source, target, reserve = 1000n) {
  const bindings = await readSequenceBindings(source);
  const results = [];
  for (const binding of bindings) {
    const [sourceMaximum, targetMaximum, targetLastValue] = await Promise.all([
      readMaximum(source, binding),
      readMaximum(target, binding),
      readSequenceValue(target, binding),
    ]);
    const requiredValue = (sourceMaximum > targetMaximum ? sourceMaximum : targetMaximum) + reserve;
    results.push({
      ...binding,
      requiredValue,
      targetLastValue,
      safe: targetLastValue !== null && targetLastValue >= requiredValue,
    });
  }
  return results;
}

export async function advanceTargetSequences(source, target, reserve = 1000n) {
  const safety = await inspectSequenceSafety(source, target, reserve);
  let advanced = 0;
  for (const item of safety) {
    if (item.safe) continue;
    const relation = `${item.sequence_schema}.${item.sequence_name}`;
    await target.$queryRawUnsafe(
      "select pg_catalog.setval($1::regclass, $2::bigint, true)",
      relation,
      item.requiredValue,
    );
    advanced += 1;
  }
  return { checked: safety.length, advanced };
}

function environmentEvidence(code) {
  return {
    code,
    ready: process.env[code] === "true",
    evidence: process.env[code] === "true" ? "CONFIRMED" : "NOT_CONFIRMED",
  };
}

export async function inspectDrReadiness(
  clients,
  {
    requirePrimaryFrozen = false,
    requireRuntimeIdentity = true,
    requireSequenceSafety = true,
    maxLagSeconds = 30,
    maxSnapshotAgeSeconds = 60,
  } = {},
) {
  const now = new Date();
  const [
    primaryReachable,
    drReachable,
    primaryRuntime,
    drRuntime,
    primaryMigrationDigest,
    drMigrationDigest,
    snapshot,
    sequences,
  ] = await Promise.all([
    probe(clients.primary),
    probe(clients.dr),
    readRuntimeState(clients.primary),
    readRuntimeState(clients.dr),
    migrationDigest(clients.primary),
    migrationDigest(clients.dr),
    readReplicationSnapshot(clients.primary),
    requireSequenceSafety
      ? inspectSequenceSafety(clients.primary, clients.dr)
      : Promise.resolve([]),
  ]);
  const snapshotAgeSeconds = snapshot
    ? Math.max(0, (now.getTime() - snapshot.observedAt.getTime()) / 1000)
    : null;
  const primaryRoleReady = requirePrimaryFrozen
    ? primaryRuntime.backendRole === "SEALED" && !primaryRuntime.writesEnabled
    : primaryRuntime.backendRole === "ACTIVE_WRITER" && primaryRuntime.writesEnabled;
  const checks = [
    { code: "PRIMARY_REACHABLE", ready: primaryReachable },
    { code: "DR_REACHABLE", ready: drReachable },
    {
      code: "PRIMARY_RUNTIME_READY",
      ready: !requireRuntimeIdentity || (
        primaryRuntime.backendCode === "PRIMARY"
        && primaryRuntime.enforcementEnabled
        && primaryRoleReady
      ),
    },
    {
      code: "DR_RUNTIME_READY",
      ready: !requireRuntimeIdentity || (
        drRuntime.backendCode === "DR"
        && drRuntime.backendRole === "READ_ONLY_STANDBY"
        && !drRuntime.writesEnabled
        && drRuntime.enforcementEnabled
      ),
    },
    {
      code: "MIGRATION_HISTORY_MATCHES",
      ready: primaryMigrationDigest === drMigrationDigest,
    },
    {
      code: "REPLICATION_CONNECTED",
      ready: snapshot?.status === "CONNECTED",
    },
    {
      code: "REPLICATION_SCHEMA_COMPATIBLE",
      ready: snapshot?.schemaCompatible === true,
    },
    {
      code: "REPLICATION_LAG_WITHIN_RPO",
      ready: snapshot?.lagSeconds !== null
        && snapshot?.lagSeconds !== undefined
        && snapshot.lagSeconds <= maxLagSeconds,
      evidence: snapshot?.lagSeconds ?? null,
    },
    {
      code: "REPLICATION_OBSERVATION_FRESH",
      ready: snapshotAgeSeconds !== null && snapshotAgeSeconds <= maxSnapshotAgeSeconds,
      evidence: snapshotAgeSeconds,
    },
    {
      code: "STORAGE_MIRROR_HEALTHY",
      ready: snapshot?.storageMirrorHealthy === true,
    },
    {
      code: "SEQUENCES_RESERVED",
      ready: !requireSequenceSafety || sequences.every((item) => item.safe),
      evidence: requireSequenceSafety
        ? { checked: sequences.length, unsafe: sequences.filter((item) => !item.safe).length }
        : "DEFERRED_TO_PREPARE",
    },
    environmentEvidence("DR_AUTH_READY"),
    environmentEvidence("DR_EDGE_FUNCTIONS_READY"),
    environmentEvidence("DR_TURNSTILE_READY"),
    environmentEvidence("DR_PAYMENT_CALLBACK_READY"),
    environmentEvidence("DR_NO_ACTIVE_MIGRATION_CONFIRMED"),
  ];
  return {
    ...evaluateReadiness(checks),
    primaryRuntime,
    drRuntime,
    replication: snapshot
      ? {
          status: snapshot.status,
          lagSeconds: snapshot.lagSeconds,
          schemaCompatible: snapshot.schemaCompatible,
          storageMirrorHealthy: snapshot.storageMirrorHealthy,
          observedAt: snapshot.observedAt.toISOString(),
          receivedLsn: snapshot.receivedLsn,
          replayLsn: snapshot.replayLsn,
        }
      : null,
  };
}

export async function inspectFailbackReadiness(
  clients,
  {
    requireDrFrozen = false,
    requireSequenceSafety = true,
  } = {},
) {
  const [
    primaryReachable,
    drReachable,
    primaryRuntime,
    drRuntime,
    primaryMigrationDigest,
    drMigrationDigest,
    sequences,
  ] = await Promise.all([
    probe(clients.primary),
    probe(clients.dr),
    readRuntimeState(clients.primary),
    readRuntimeState(clients.dr),
    migrationDigest(clients.primary),
    migrationDigest(clients.dr),
    requireSequenceSafety
      ? inspectSequenceSafety(clients.dr, clients.primary)
      : Promise.resolve([]),
  ]);
  const drRoleReady = requireDrFrozen
    ? drRuntime.backendRole === "SEALED" && !drRuntime.writesEnabled
    : drRuntime.backendRole === "ACTIVE_WRITER" && drRuntime.writesEnabled;
  const checks = [
    { code: "PRIMARY_REACHABLE", ready: primaryReachable },
    { code: "DR_REACHABLE", ready: drReachable },
    {
      code: "PRIMARY_FENCED",
      ready: primaryRuntime.backendCode === "PRIMARY"
        && primaryRuntime.enforcementEnabled
        && ["SEALED", "READ_ONLY_STANDBY"].includes(primaryRuntime.backendRole)
        && !primaryRuntime.writesEnabled,
    },
    {
      code: "DR_RUNTIME_READY",
      ready: drRuntime.backendCode === "DR"
        && drRuntime.enforcementEnabled
        && drRoleReady,
    },
    {
      code: "MIGRATION_HISTORY_MATCHES",
      ready: primaryMigrationDigest === drMigrationDigest,
    },
    {
      code: "SEQUENCES_RESERVED",
      ready: !requireSequenceSafety || sequences.every((item) => item.safe),
      evidence: requireSequenceSafety
        ? { checked: sequences.length, unsafe: sequences.filter((item) => !item.safe).length }
        : "DEFERRED_TO_PREPARE",
    },
    environmentEvidence("PRIMARY_BACKUP_READY"),
    environmentEvidence("DR_BACKUP_READY"),
    environmentEvidence("DR_WRITES_RECONCILED"),
    environmentEvidence("DR_AUTH_IDENTITIES_VALIDATED"),
    environmentEvidence("DR_STORAGE_VALIDATED"),
    environmentEvidence("DR_BUSINESS_DATA_VALIDATED"),
    environmentEvidence("DR_NO_ACTIVE_MIGRATION_CONFIRMED"),
  ];
  return {
    ...evaluateReadiness(checks),
    primaryRuntime,
    drRuntime,
  };
}

export async function transitionRuntime(database, input) {
  const rows = await database.$queryRawUnsafe(
    `select *
     from app_private.transition_backend_runtime(
       $1::text,
       $2::bigint,
       $3::text,
       $4::text,
       $5::bigint,
       $6::text,
       $7::uuid
     )`,
    input.expectedBackendCode,
    BigInt(input.expectedPromotionEpoch),
    input.targetBackendCode,
    input.targetBackendRole,
    BigInt(input.targetPromotionEpoch),
    input.reason,
    input.actorProfileId,
  );
  const state = rows[0];
  if (!state) throw new FailoverOperationError("BACKEND_TRANSITION_NO_RESULT");
  return {
    backendCode: state.backend_code,
    backendRole: state.backend_role,
    promotionEpoch: Number.parseInt(state.promotion_epoch.toString(), 10),
    writesEnabled: state.writes_enabled,
    enforcementEnabled: state.enforcement_enabled,
  };
}

export async function recordFailoverEvent(database, input) {
  await database.$executeRawUnsafe(
    `insert into public.backend_failover_events (
       state,
       source_backend_code,
       target_backend_code,
       health_evidence,
       replication_lag_seconds,
       last_known_lsn,
       requested_by_profile_id,
       approved_by_profile_id,
       reason,
       rpo_estimate_seconds,
       split_brain_acknowledged,
       transition_completed_at
     )
     values (
       $1::text,
       $2::text,
       $3::text,
       $4::jsonb,
       $5::numeric,
       $6::text,
       $7::uuid,
       $8::uuid,
       $9::text,
       $10::integer,
       $11::boolean,
       now()
     )`,
    input.state,
    input.sourceBackendCode,
    input.targetBackendCode,
    JSON.stringify(input.healthEvidence ?? {}),
    input.replicationLagSeconds ?? null,
    input.lastKnownLsn ?? null,
    input.requestedByProfileId,
    input.approvedByProfileId,
    input.reason,
    input.rpoEstimateSeconds ?? null,
    input.splitBrainAcknowledged === true,
  );
}

export function sanitizedReadinessEvidence(readiness) {
  return {
    ready: readiness.ready,
    blockers: readiness.blockers,
    checks: readiness.checks.map((check) => ({
      code: check.code,
      ready: check.ready,
      evidence: typeof check.evidence === "number" || typeof check.evidence === "string"
        ? check.evidence
        : null,
    })),
  };
}
