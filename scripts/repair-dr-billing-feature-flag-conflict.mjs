import { PrismaClient } from "@prisma/client";
import {
  buildRepairPlan,
  DrBillingFeatureFlagConflictError,
  einvoiceFeatureFlagCodes,
  normalizeRows,
  verifyRepair,
} from "./lib/dr-billing-feature-flag-conflict.mjs";
import { readRuntimeState } from "./lib/dr-failover-operations.mjs";

const subscriptionName = "stallorder_primary_to_dr";
const args = new Set(process.argv.slice(2));
const inspect = args.has("--inspect");
const apply = args.has("--apply");
const verify = args.has("--verify");
if ([inspect, apply, verify].filter(Boolean).length !== 1) {
  fail("EXACTLY_ONE_ACTION_REQUIRED");
}

const primary = new PrismaClient({
  datasources: { db: { url: requiredPostgresUrl("DIRECT_URL") } },
});
const dr = new PrismaClient({
  datasources: { db: { url: requiredPostgresUrl("DR_DIRECT_URL") } },
});
let subscriptionDisabled = false;

try {
  if (inspect) {
    requireConfirmation("INSPECT_DR_BILLING_FEATURE_FLAG_CONFLICT");
    const plan = await inspectRepairableState();
    console.log(JSON.stringify({
      mode: "live-read-only-plan",
      action: "REPAIR_DR_BILLING_FEATURE_FLAG_CONFLICT",
      source: "PRIMARY",
      target: "DR",
      strategy: "DELETE_VERIFIED_DR_SEED_DUPLICATES_THEN_REPLAY_PRIMARY_WAL",
      ...plan,
      changesRemoteState: false,
    }, null, 2));
  } else if (apply) {
    requireConfirmation("REPAIR_DR_BILLING_FEATURE_FLAG_CONFLICT");
    const plan = await inspectRepairableState();
    await dr.$executeRawUnsafe(
      `alter subscription "${subscriptionName}" disable`,
    );
    subscriptionDisabled = true;
    await waitForSubscriptionWorkerToStop();
    const deletedCodes = await deleteVerifiedDrRows(plan.drRowDigest);
    await dr.$executeRawUnsafe(
      `alter subscription "${subscriptionName}" enable`,
    );
    subscriptionDisabled = false;
    console.log(JSON.stringify({
      event: "dr_billing_feature_flag_conflict_repaired",
      subscriptionName,
      deletedRowCount: deletedCodes.length,
      deletedCodes,
      subscriptionReenabled: true,
      readinessRequired: true,
    }, null, 2));
  } else {
    requireConfirmation("VERIFY_DR_BILLING_FEATURE_FLAG_REPAIR");
    await assertRuntimeRoles();
    await assertSubscriptionEnabled();
    await assertWriteGuardEnabled(dr);
    const [primaryRows, drRows] = await Promise.all([
      readFeatureFlags(primary),
      readFeatureFlags(dr),
    ]);
    const result = verifyRepair({ primaryRows, drRows });
    console.log(JSON.stringify({
      event: "dr_billing_feature_flag_conflict_repair_verified",
      subscriptionName,
      ...result,
    }, null, 2));
  }
} catch (error) {
  if (subscriptionDisabled) {
    await dr.$executeRawUnsafe(
      `alter subscription "${subscriptionName}" enable`,
    ).catch(() => null);
  }
  console.error(JSON.stringify({
    event: "dr_billing_feature_flag_conflict_repair_failed",
    reason: safeReason(error),
  }));
  process.exitCode = 1;
} finally {
  await Promise.allSettled([primary.$disconnect(), dr.$disconnect()]);
}

async function inspectRepairableState() {
  await assertRuntimeRoles();
  await assertSubscriptionEnabled();
  await assertWriteGuardEnabled(dr);
  const [primaryRows, drRows] = await Promise.all([
    readFeatureFlags(primary),
    readFeatureFlags(dr),
  ]);
  return buildRepairPlan({ primaryRows, drRows });
}

async function assertRuntimeRoles() {
  const [primaryRuntime, drRuntime] = await Promise.all([
    readRuntimeState(primary),
    readRuntimeState(dr),
  ]);
  if (
    primaryRuntime.backendCode !== "PRIMARY"
    || primaryRuntime.backendRole !== "ACTIVE_WRITER"
    || primaryRuntime.writesEnabled !== true
    || primaryRuntime.enforcementEnabled !== true
    || primaryRuntime.isCurrent !== true
  ) {
    throw new DrBillingFeatureFlagConflictError("PRIMARY_RUNTIME_STATE_NOT_READY");
  }
  if (
    drRuntime.backendCode !== "DR"
    || drRuntime.backendRole !== "READ_ONLY_STANDBY"
    || drRuntime.writesEnabled !== false
    || drRuntime.enforcementEnabled !== true
    || drRuntime.isCurrent !== true
  ) {
    throw new DrBillingFeatureFlagConflictError("DR_RUNTIME_STATE_NOT_READY");
  }
}

async function assertSubscriptionEnabled() {
  const rows = await dr.$queryRawUnsafe(
    `select subenabled
     from pg_catalog.pg_subscription
     where subname = $1
     limit 1`,
    subscriptionName,
  );
  if (rows[0]?.subenabled !== true) {
    throw new DrBillingFeatureFlagConflictError("DR_SUBSCRIPTION_NOT_ENABLED");
  }
}

async function waitForSubscriptionWorkerToStop() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const rows = await dr.$queryRawUnsafe(
      `select stats.pid
       from pg_catalog.pg_subscription subscription
       left join pg_catalog.pg_stat_subscription stats
         on stats.subid = subscription.oid
       where subscription.subname = $1
       limit 1`,
      subscriptionName,
    );
    if (!rows[0]?.pid) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new DrBillingFeatureFlagConflictError("DR_SUBSCRIPTION_WORKER_DID_NOT_STOP");
}

async function assertWriteGuardEnabled(database) {
  const rows = await database.$queryRawUnsafe(
    `select trigger.tgenabled
     from pg_catalog.pg_trigger trigger
     join pg_catalog.pg_class relation on relation.oid = trigger.tgrelid
     join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
     where namespace.nspname = 'public'
       and relation.relname = 'billing_feature_flags'
       and trigger.tgname = 'backend_writable_guard'
       and not trigger.tgisinternal`,
  );
  if (rows.length !== 1 || rows[0].tgenabled !== "O") {
    throw new DrBillingFeatureFlagConflictError("DR_WRITE_GUARD_NOT_ENABLED");
  }
}

async function deleteVerifiedDrRows(expectedDigest) {
  return dr.$transaction(async (transaction) => {
    await assertWriteGuardEnabled(transaction);
    const lockedRows = await readFeatureFlags(transaction, " for update");
    const normalized = normalizeRows(lockedRows);
    const plan = buildRepairPlan({
      primaryRows: await readFeatureFlags(primary),
      drRows: lockedRows,
    });
    if (plan.drRowDigest !== expectedDigest) {
      throw new DrBillingFeatureFlagConflictError("DR_FEATURE_FLAG_STATE_CHANGED_AFTER_PLAN");
    }
    await transaction.$executeRawUnsafe(
      "alter table public.billing_feature_flags disable trigger backend_writable_guard",
    );
    const deleted = await transaction.$queryRawUnsafe(
      `delete from public.billing_feature_flags
       where code = any($1::text[])
       returning code`,
      normalized.map((row) => row.code),
    );
    if (deleted.length !== einvoiceFeatureFlagCodes.length) {
      throw new DrBillingFeatureFlagConflictError("DR_FEATURE_FLAG_DELETE_COUNT_MISMATCH");
    }
    await transaction.$executeRawUnsafe(
      "alter table public.billing_feature_flags enable trigger backend_writable_guard",
    );
    return deleted.map((row) => String(row.code)).sort();
  }, { timeout: 30_000 });
}

function readFeatureFlags(database, suffix = "") {
  return database.$queryRawUnsafe(
    `select code, is_enabled, phase, description, created_at, updated_at
     from public.billing_feature_flags
     where code = any($1::text[])
     order by code${suffix}`,
    [...einvoiceFeatureFlagCodes],
  );
}

function requiredPostgresUrl(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name}_MISSING`);
  try {
    const parsed = new URL(value);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error();
  } catch {
    fail(`${name}_INVALID`);
  }
  return value;
}

function requireConfirmation(expected) {
  if (process.env.PRODUCTION_ENVIRONMENT_APPROVED !== "true") {
    throw new DrBillingFeatureFlagConflictError("PRODUCTION_ENVIRONMENT_NOT_APPROVED");
  }
  if (process.env.DR_CHANGE_CONFIRMATION !== expected) {
    throw new DrBillingFeatureFlagConflictError(`CONFIRMATION_REQUIRED_${expected}`);
  }
}

function safeReason(error) {
  return error instanceof DrBillingFeatureFlagConflictError
    ? error.code
    : error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)
      ? error.message
      : "DR_BILLING_FEATURE_FLAG_CONFLICT_REPAIR_FAILED";
}

function fail(reason) {
  console.error(JSON.stringify({
    event: "dr_billing_feature_flag_conflict_repair_failed",
    reason,
  }));
  process.exit(1);
}
