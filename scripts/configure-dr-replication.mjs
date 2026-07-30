import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  buildPublicationTableExpression,
  environmentLocalTables,
  replicationColumnExclusions,
  replicatedPublicTables,
} from "./lib/dr-replication-scope.mjs";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const rollback = args.has("--rollback");
const source = valueAfter("--source");
const target = valueAfter("--target");
const publicationName = "stallorder_primary_to_dr";
const subscriptionName = "stallorder_primary_to_dr";

if (source !== "PRIMARY" || target !== "DR") {
  fail("必須明確指定 --source PRIMARY --target DR。");
}
if (apply && rollback) fail("--apply 與 --rollback 不可同時使用。");

const action = rollback ? "ROLLBACK_PRIMARY_TO_DR" : "CONFIGURE_PRIMARY_TO_DR";
const plan = {
  mode: apply || rollback ? "apply" : "dry-run",
  action,
  source,
  target,
  publicationName,
  subscriptionName,
  replicatedTableCount: replicatedPublicTables.length,
  excludedEnvironmentLocalTables: environmentLocalTables,
  excludedColumnsByTable: replicationColumnExclusions,
  safeguards: [
    "單向 Primary 到 DR",
    "不發布 TRUNCATE",
    "DR 必須已啟用 fencing 且為 READ_ONLY_STANDBY",
    "Primary 與 DR migration history 必須一致",
    "不輸出連線字串或憑證",
  ],
  rollback: [
    "在 DR 停用並移除 subscription",
    "在 Primary 移除 publication",
    "保留資料與稽核紀錄",
  ],
};

if (!apply && !rollback) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}

if (process.env.PRODUCTION_ENVIRONMENT_APPROVED !== "true") {
  fail(
    "缺少 Production Environment 核准：PRODUCTION_ENVIRONMENT_APPROVED=true。",
  );
}
if (process.env.DR_CHANGE_CONFIRMATION !== action) {
  fail(`請輸入確認字串 ${action} 至 DR_CHANGE_CONFIRMATION。`);
}

const primaryDirectUrl = requiredPostgresUrl("DIRECT_URL");
const drDirectUrl = requiredPostgresUrl("DR_DIRECT_URL");
const replicationUrl = rollback
  ? null
  : requiredPostgresUrl("PRIMARY_REPLICATION_URL");
const primary = new PrismaClient({
  datasources: { db: { url: primaryDirectUrl } },
});
const dr = new PrismaClient({ datasources: { db: { url: drDirectUrl } } });

try {
  if (rollback) {
    const subscriptions = await dr.$queryRawUnsafe(
      "select 1 from pg_catalog.pg_subscription where subname = $1",
      subscriptionName,
    );
    const publications = await primary.$queryRawUnsafe(
      "select 1 from pg_catalog.pg_publication where pubname = $1",
      publicationName,
    );
    if (subscriptions.length === 1) {
      await dr.$executeRawUnsafe(
        `alter subscription ${quoteIdentifier(subscriptionName)} disable`,
      );
      await dr.$executeRawUnsafe(
        `drop subscription ${quoteIdentifier(subscriptionName)}`,
      );
    }
    if (publications.length === 1) {
      await primary.$executeRawUnsafe(
        `drop publication ${quoteIdentifier(publicationName)}`,
      );
    }
    console.log(
      JSON.stringify({
        event: "dr_replication_rollback_completed",
        publicationName,
        subscriptionName,
        subscriptionRemoved: subscriptions.length === 1,
        publicationRemoved: publications.length === 1,
      }),
    );
  } else {
    await assertRuntimeState(primary, "PRIMARY", "ACTIVE_WRITER", true);
    await assertRuntimeState(dr, "DR", "READ_ONLY_STANDBY", false);
    await assertMigrationHistoryMatches(primary, dr);
    await assertAllTablesHavePrimaryKeys(primary);
    await assertPublicationAbsent(primary);
    await assertSubscriptionAbsent(dr);

    const columnsByTable = await readPublicationColumns(primary);
    const tableList = replicatedPublicTables
      .map((table) =>
        buildPublicationTableExpression(table, columnsByTable.get(table) ?? []),
      )
      .join(", ");
    await primary.$executeRawUnsafe(
      `create publication ${quoteIdentifier(publicationName)} for table ${tableList} with (publish = 'insert, update, delete')`,
    );
    try {
      await dr.$executeRawUnsafe(
        `create subscription ${quoteIdentifier(subscriptionName)} connection ${quoteLiteral(replicationUrl)} publication ${quoteIdentifier(publicationName)} with (copy_data = true, create_slot = true, enabled = true, streaming = on, two_phase = false)`,
      );
    } catch {
      await primary.$executeRawUnsafe(
        `drop publication if exists ${quoteIdentifier(publicationName)}`,
      );
      throw new Error("SUBSCRIPTION_CREATE_FAILED");
    }
    console.log(
      JSON.stringify({
        event: "dr_replication_configured",
        publicationName,
        subscriptionName,
        replicatedTableCount: replicatedPublicTables.length,
      }),
    );
  }
} catch {
  console.error(
    JSON.stringify({
      event: "dr_replication_change_failed",
      action,
      reason: "VALIDATION_OR_PROVIDER_OPERATION_FAILED",
    }),
  );
  process.exitCode = 1;
} finally {
  await Promise.allSettled([primary.$disconnect(), dr.$disconnect()]);
}

function valueAfter(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function requiredPostgresUrl(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`缺少 ${name}。`);
  try {
    const parsed = new URL(value);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol))
      throw new Error();
  } catch {
    fail(`${name} 必須是有效的 PostgreSQL URL。`);
  }
  return value;
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function assertRuntimeState(database, backendCode, role, writesEnabled) {
  const rows = await database.$queryRawUnsafe(
    `select backend_code, backend_role, writes_enabled, enforcement_enabled, is_current
     from public.backend_runtime_state
     where is_current
     limit 1`,
  );
  const state = rows[0];
  if (
    state?.backend_code !== backendCode ||
    state?.backend_role !== role ||
    state?.writes_enabled !== writesEnabled ||
    state?.enforcement_enabled !== true ||
    state?.is_current !== true
  ) {
    throw new Error("BACKEND_RUNTIME_STATE_NOT_READY");
  }
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

async function assertMigrationHistoryMatches(primaryDatabase, drDatabase) {
  const [primaryDigest, drDigest] = await Promise.all([
    migrationDigest(primaryDatabase),
    migrationDigest(drDatabase),
  ]);
  if (primaryDigest !== drDigest) throw new Error("MIGRATION_HISTORY_MISMATCH");
}

async function assertAllTablesHavePrimaryKeys(database) {
  const tableLiterals = replicatedPublicTables.map(quoteLiteral).join(", ");
  const missing = await database.$queryRawUnsafe(
    `select c.relname
     from pg_catalog.pg_class c
     join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname in (${tableLiterals})
       and c.relkind = 'r'
       and not exists (
         select 1
         from pg_catalog.pg_index i
         where i.indrelid = c.oid
           and i.indisprimary
       )`,
  );
  if (missing.length > 0) throw new Error("REPLICA_IDENTITY_NOT_READY");
}

async function readPublicationColumns(database) {
  const filteredTables = Object.keys(replicationColumnExclusions);
  const tableLiterals = filteredTables.map(quoteLiteral).join(", ");
  const rows = await database.$queryRawUnsafe(
    `select table_name, column_name
     from information_schema.columns
     where table_schema = 'public'
       and table_name in (${tableLiterals})
     order by table_name, ordinal_position`,
  );
  const columnsByTable = new Map();
  for (const row of rows) {
    const columns = columnsByTable.get(row.table_name) ?? [];
    columns.push(row.column_name);
    columnsByTable.set(row.table_name, columns);
  }
  return columnsByTable;
}

async function assertPublicationAbsent(database) {
  const rows = await database.$queryRawUnsafe(
    "select 1 from pg_catalog.pg_publication where pubname = $1",
    publicationName,
  );
  if (rows.length > 0) throw new Error("PUBLICATION_ALREADY_EXISTS");
}

async function assertSubscriptionAbsent(database) {
  const rows = await database.$queryRawUnsafe(
    "select 1 from pg_catalog.pg_subscription where subname = $1",
    subscriptionName,
  );
  if (rows.length > 0) throw new Error("SUBSCRIPTION_ALREADY_EXISTS");
}
