import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  buildPublicationTableExpression,
  environmentLocalTables,
  replicationColumnExclusions,
  replicatedPublicTables,
} from "./lib/dr-replication-scope.mjs";
import {
  assertDrPhysicalPublicationContract,
  assertPublicationContract,
  assertSubscriptionContract,
  assertSubscriptionRelations,
  assertSubscriptionScope,
  buildReplicationUpgradePlan,
  classifyReplicationObjectState,
  DrReplicationPublicationError,
  quoteIdentifier,
  verifyInitialCopyTargetsEmpty,
  waitForSubscriptionScope,
} from "./lib/dr-replication-publication.mjs";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const rollback = args.has("--rollback");
const inspect = args.has("--inspect");
const upgradeOnly = args.has("--upgrade-only");
const source = valueAfter("--source");
const target = valueAfter("--target");
const publicationName = "stallorder_primary_to_dr";
const subscriptionName = "stallorder_primary_to_dr";

if (source !== "PRIMARY" || target !== "DR") {
  fail("必須明確指定 --source PRIMARY --target DR。");
}
if ([apply, rollback, inspect].filter(Boolean).length > 1) {
  fail("--apply、--rollback 與 --inspect 不可同時使用。");
}

const action = rollback
  ? "ROLLBACK_PRIMARY_TO_DR"
  : inspect
    ? "INSPECT_PRIMARY_TO_DR"
    : "CONFIGURE_PRIMARY_TO_DR";
const plan = {
  mode: apply || rollback ? "apply" : inspect ? "live-read-only-plan" : "dry-run",
  action,
  source,
  target,
  publicationName,
  subscriptionName,
  strategy: upgradeOnly ? "UPGRADE_ONLY" : "CREATE_OR_UPGRADE",
  replicatedTableCount: replicatedPublicTables.length,
  excludedEnvironmentLocalTables: environmentLocalTables,
  excludedColumnsByTable: replicationColumnExclusions,
  safeguards: [
    "單向 Primary 到 DR",
    "不發布 TRUNCATE",
    "DR 必須已啟用 fencing 且為 READ_ONLY_STANDBY",
    "Primary 與 DR migration history 必須一致",
    "既有 replication 僅新增 allowlist 缺少的資料表，不 drop/recreate",
    "publication/subscription 單邊存在或含 allowlist 外資料表時 fail closed",
    "publication 必須符合 publish flags、逐表欄位清單與無 row filter 的精確契約",
    "subscription 必須位於目前 DR 資料庫，且 publication、slot、streaming、two-phase 與 Primary endpoint identity 精確相符",
    "REFRESH 後重讀完整 catalog 並等待所有 relation 明確進入初始化或 ready 狀態，再接 readiness",
    "不輸出連線字串或憑證",
  ],
  ...(upgradeOnly
    ? {
        upgradeOnly: [
          "publication/subscription 必須都已存在，否則 fail closed",
          "新增 subscription relation 前驗證 DR 目標表為空",
          "只 ADD allowlist 缺表並在 DR REFRESH PUBLICATION WITH (copy_data = true)",
          "已完全一致時 no-op",
        ],
      }
    : {
        createOrUpgrade: [
          "publication/subscription 都不存在時初建",
          "增量新增 subscription relation 前驗證 DR 目標表為空",
          "兩者都存在時比對 scope，只 ADD 缺表並在 DR REFRESH PUBLICATION WITH (copy_data = true)",
          "已完全一致時 no-op",
        ],
      }),
  dryRunGuarantees: {
    connectsToDatabases: false,
    changesRemoteState: false,
  },
  rollback: [
    "刪除前驗證精確 flags 與 endpoint；允許安全 allowlist 子集，拒絕任何非預期 scope",
    "在 DR 停用並移除 subscription",
    "在 Primary 移除 publication",
    "保留資料與稽核紀錄",
  ],
};

if (!apply && !rollback && !inspect) {
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
const replicationUrl = requiredPostgresUrl("PRIMARY_REPLICATION_URL");
const primary = new PrismaClient({
  datasources: { db: { url: primaryDirectUrl } },
});
const dr = new PrismaClient({ datasources: { db: { url: drDirectUrl } } });

try {
  if (rollback) {
    const columnsByTable = await readPublicationColumns(primary);
    const [publicationExists, subscriptionExists] = await Promise.all([
      replicationObjectExists(primary, "PUBLICATION", publicationName),
      replicationObjectExists(dr, "SUBSCRIPTION", subscriptionName),
    ]);
    if (publicationExists) {
      assertPublicationContract({
        definition: await readPublicationDefinition(primary),
        allowlistedTables: replicatedPublicTables,
        publicationRows: await readPublicationTables(primary),
        columnsByTable,
        columnExclusions: replicationColumnExclusions,
      });
    }
    if (subscriptionExists) {
      const subscriptionDefinition = await readSubscriptionDefinition(dr);
      assertSubscriptionContract({
        definition: subscriptionDefinition,
        publicationName,
        subscriptionName,
        drDirectUrl,
        primaryReplicationUrl: replicationUrl,
        allowDisabled: true,
      });
      assertSubscriptionScope({
        allowlistedTables: replicatedPublicTables,
        relationRows: await readSubscriptionRelations(dr),
      });
      if (subscriptionDefinition.enabled) {
        await dr.$executeRawUnsafe(
          `alter subscription ${quoteIdentifier(subscriptionName)} disable`,
        );
      }
      await dr.$executeRawUnsafe(
        `drop subscription ${quoteIdentifier(subscriptionName)}`,
      );
    }
    if (publicationExists) {
      await primary.$executeRawUnsafe(
        `drop publication ${quoteIdentifier(publicationName)}`,
      );
    }
    const [publicationRemains, subscriptionRemains] = await Promise.all([
      replicationObjectExists(primary, "PUBLICATION", publicationName),
      replicationObjectExists(dr, "SUBSCRIPTION", subscriptionName),
    ]);
    if (publicationRemains || subscriptionRemains) {
      throw new Error("REPLICATION_ROLLBACK_POSTCONDITION_FAILED");
    }
    console.log(
      JSON.stringify({
        event: "dr_replication_rollback_completed",
        publicationName,
        subscriptionName,
        subscriptionRemoved: subscriptionExists,
        publicationRemoved: publicationExists,
      }),
    );
  } else {
    await assertRuntimeState(primary, "PRIMARY", "ACTIVE_WRITER", true);
    await assertRuntimeState(dr, "DR", "READ_ONLY_STANDBY", false);
    await assertMigrationHistoryMatches(primary, dr);
    await assertAllTablesHavePrimaryKeys(primary);
    const [
      columnsByTable,
      drColumnsByTable,
      primaryPhysicalTables,
      drPhysicalTables,
    ] = await Promise.all([
      readPublicationColumns(primary),
      readPublicationColumns(dr),
      readPhysicalPublicationContract(primary),
      readPhysicalPublicationContract(dr),
    ]);
    assertAllSourceTablesHaveColumns(columnsByTable);
    const physicalContract = assertDrPhysicalPublicationContract({
      allowlistedTables: replicatedPublicTables,
      primaryColumnsByTable: columnsByTable,
      drColumnsByTable,
      primaryPhysicalTables,
      drPhysicalTables,
      columnExclusions: replicationColumnExclusions,
    });
    const [publicationExists, subscriptionExists] = await Promise.all([
      replicationObjectExists(primary, "PUBLICATION", publicationName),
      replicationObjectExists(dr, "SUBSCRIPTION", subscriptionName),
    ]);
    const replicationObjectState = classifyReplicationObjectState({
      publicationExists,
      subscriptionExists,
      requireExisting: upgradeOnly,
    });

    let completedOperation;
    let missingPublicationTables = [];
    let refreshedSubscription = false;
    if (replicationObjectState === "CREATE") {
      if (inspect) {
        throw new DrReplicationPublicationError(
          "REPLICATION_OBJECTS_REQUIRED_FOR_LIVE_INSPECTION",
        );
      }
      const tableList = replicatedPublicTables
        .map((table) =>
          buildPublicationTableExpression(table, columnsByTable.get(table) ?? []),
        )
        .join(", ");
      await primary.$executeRawUnsafe(
        `create publication ${quoteIdentifier(publicationName)} for table ${tableList} with (publish = 'insert, update, delete', publish_via_partition_root = false)`,
      );
      try {
        await dr.$executeRawUnsafe(
          `create subscription ${quoteIdentifier(subscriptionName)} connection ${quoteLiteral(replicationUrl)} publication ${quoteIdentifier(publicationName)} with (copy_data = true, create_slot = true, slot_name = ${quoteLiteral(subscriptionName)}, enabled = true, streaming = on, two_phase = false)`,
        );
      } catch {
        throw new Error("SUBSCRIPTION_CREATE_FAILED_PUBLICATION_RETAINED");
      }
      completedOperation = "CREATE";
      missingPublicationTables = [...replicatedPublicTables];
      refreshedSubscription = true;
    } else {
      const [
        publicationDefinition,
        publicationRows,
        subscriptionDefinition,
        subscriptionRelationRows,
      ] = await Promise.all([
        readPublicationDefinition(primary),
        readPublicationTables(primary),
        readSubscriptionDefinition(dr),
        readSubscriptionRelations(dr),
      ]);
      assertPublicationContract({
        definition: publicationDefinition,
        allowlistedTables: replicatedPublicTables,
        publicationRows,
        columnsByTable,
        columnExclusions: replicationColumnExclusions,
      });
      assertSubscriptionContract({
        definition: subscriptionDefinition,
        publicationName,
        subscriptionName,
        drDirectUrl,
        primaryReplicationUrl: replicationUrl,
      });
      const upgradePlan = buildReplicationUpgradePlan({
        publicationName,
        subscriptionName,
        allowlistedTables: replicatedPublicTables,
        publicationRows,
        subscriptionRelationRows,
        columnsByTable,
      });
      const initialCopyTargetEmptiness = await verifyInitialCopyTargetsEmpty({
        tables: upgradePlan.missingSubscriptionTables,
        hasRows: (table) => readTableHasRows(dr, table),
      });

      if (inspect) {
        console.log(JSON.stringify({
          mode: "live-read-only-plan",
          action,
          strategy: upgradeOnly ? "UPGRADE_ONLY" : "CREATE_OR_UPGRADE",
          publicationName,
          subscriptionName,
          operation: upgradePlan.mode,
          missingPublicationTables: upgradePlan.missingPublicationTables,
          missingSubscriptionTables: upgradePlan.missingSubscriptionTables,
          initialCopyTargetEmptiness,
          physicalContract,
          exactExistingContractVerified: true,
          changesRemoteState: false,
        }, null, 2));
        completedOperation = upgradePlan.mode;
      } else {
        for (const statement of upgradePlan.primaryStatements) {
          await primary.$executeRawUnsafe(statement);
        }
        for (const statement of upgradePlan.drStatements) {
          await dr.$executeRawUnsafe(statement);
        }
        completedOperation = upgradePlan.mode;
        missingPublicationTables = upgradePlan.missingPublicationTables;
        refreshedSubscription = upgradePlan.drStatements.length > 0;
      }
    }

    if (inspect) {
      if (!completedOperation) {
        throw new Error("LIVE_INSPECTION_RESULT_MISSING");
      }
    } else {
      const verified = await verifyExactReplicationContract({
      primary,
      dr,
      columnsByTable,
      drDirectUrl,
      replicationUrl,
      });
      console.log(
        JSON.stringify({
          event: completedOperation === "NO_OP"
            ? "dr_replication_already_current"
            : completedOperation === "CREATE"
              ? "dr_replication_configured"
              : "dr_replication_upgraded",
          operation: completedOperation,
          publicationName,
          subscriptionName,
          addedPublicationTables: missingPublicationTables,
          refreshedSubscription,
          replicationInitialization: verified.initializationState,
          verifiedRelations: verified.verifiedRelations,
          physicalContract,
          exactContractVerified: true,
          readinessRequired: true,
          replicatedTableCount: replicatedPublicTables.length,
        }),
      );
    }
  }
} catch (error) {
  const safeReason = error instanceof DrReplicationPublicationError
    ? error.code
    : error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "VALIDATION_OR_PROVIDER_OPERATION_FAILED";
  console.error(
    JSON.stringify({
      event: "dr_replication_change_failed",
      action,
      reason: safeReason,
      details: error instanceof DrReplicationPublicationError ? error.details : undefined,
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
    `select
       version::text as version,
       name,
       statements::text[] as statements
     from supabase_migrations.schema_migrations
     order by version`,
  );
  if (rows.some((row) => (
    typeof row.version !== "string"
    || (row.name !== null && typeof row.name !== "string")
    || (row.statements !== null && (
      !Array.isArray(row.statements)
      || row.statements.some((statement) => typeof statement !== "string")
    ))
  ))) {
    throw new Error("MIGRATION_HISTORY_INVALID");
  }
  return createHash("sha256")
    .update(JSON.stringify(rows.map((row) => ({
      version: row.version,
      name: row.name ?? null,
      statements: row.statements ?? [],
    }))))
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
  const tableLiterals = replicatedPublicTables.map(quoteLiteral).join(", ");
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

async function replicationObjectExists(database, objectType, objectName) {
  const rows = objectType === "PUBLICATION"
    ? await database.$queryRawUnsafe(
      "select 1 from pg_catalog.pg_publication where pubname = $1",
      objectName,
    )
    : objectType === "SUBSCRIPTION"
      ? await database.$queryRawUnsafe(
        "select 1 from pg_catalog.pg_subscription where subname = $1",
        objectName,
      )
      : null;
  if (!rows || rows.length > 1) {
    throw new Error("REPLICATION_OBJECT_LOOKUP_INVALID");
  }
  return rows.length === 1;
}

async function readPhysicalPublicationContract(database) {
  const tableLiterals = replicatedPublicTables.map(quoteLiteral).join(", ");
  const rows = await database.$queryRawUnsafe(
    `select
       relation.relname as "tableName",
       relation.relkind::text as "tableKind",
       attribute.attname as "columnName",
       pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) as "dataType",
       attribute.attnotnull as "notNull",
       attribute.attgenerated::text as generated,
       attribute.attidentity::text as identity,
       (attribute_default.oid is not null) as "hasDefault"
     from pg_catalog.pg_class relation
     join pg_catalog.pg_namespace namespace
       on namespace.oid = relation.relnamespace
     join pg_catalog.pg_attribute attribute
       on attribute.attrelid = relation.oid
      and attribute.attnum > 0
      and not attribute.attisdropped
     left join pg_catalog.pg_attrdef attribute_default
       on attribute_default.adrelid = relation.oid
      and attribute_default.adnum = attribute.attnum
     where namespace.nspname = 'public'
       and relation.relname in (${tableLiterals})
     order by relation.relname, attribute.attnum`,
  );
  const tables = new Map();
  for (const row of rows) {
    const table = tables.get(row.tableName) ?? {
      kind: row.tableKind,
      columns: new Map(),
    };
    if (table.kind !== row.tableKind || table.columns.has(row.columnName)) {
      throw new Error("PHYSICAL_PUBLICATION_CATALOG_INVALID");
    }
    table.columns.set(row.columnName, {
      dataType: row.dataType,
      notNull: row.notNull,
      generated: row.generated,
      identity: row.identity,
      hasDefault: row.hasDefault,
    });
    tables.set(row.tableName, table);
  }
  return tables;
}

function assertAllSourceTablesHaveColumns(columnsByTable) {
  const missingTables = replicatedPublicTables.filter((table) => (
    !Array.isArray(columnsByTable.get(table))
    || columnsByTable.get(table).length === 0
  ));
  if (missingTables.length > 0) {
    throw new DrReplicationPublicationError("PUBLICATION_SOURCE_COLUMNS_MISSING", {
      tables: missingTables,
    });
  }
}

async function readPublicationTables(database) {
  return database.$queryRawUnsafe(
    `select
       tables.schemaname as "schemaName",
       tables.tablename as "tableName",
       tables.attnames::text[] as "columnNames",
       tables.rowfilter as "rowFilter"
     from pg_catalog.pg_publication_tables tables
     where tables.pubname = $1
     order by tables.schemaname, tables.tablename`,
    publicationName,
  );
}

async function readPublicationDefinition(database) {
  const rows = await database.$queryRawUnsafe(
    `select
       publication.puballtables as "allTables",
       publication.pubinsert as "publishInsert",
       publication.pubupdate as "publishUpdate",
       publication.pubdelete as "publishDelete",
       publication.pubtruncate as "publishTruncate",
       publication.pubviaroot as "publishViaRoot"
     from pg_catalog.pg_publication publication
     where publication.pubname = $1`,
    publicationName,
  );
  if (rows.length !== 1) {
    throw new DrReplicationPublicationError("PUBLICATION_DEFINITION_LOOKUP_INVALID");
  }
  return rows[0];
}

async function readSubscriptionDefinition(database) {
  const rows = await database.$queryRawUnsafe(
    `select
       current_database() as "currentDatabase",
       subscription_database.datname as "databaseName",
       subscription.subenabled as enabled,
       subscription.subpublications::text[] as publications,
       subscription.subslotname::text as "slotName",
       subscription.substream::text as streaming,
       subscription.subtwophasestate::text as "twoPhaseState",
       subscription.subconninfo as "connectionInfo"
     from pg_catalog.pg_subscription subscription
     join pg_catalog.pg_database subscription_database
       on subscription_database.oid = subscription.subdbid
     where subscription.subname = $1`,
    subscriptionName,
  );
  if (rows.length !== 1) {
    throw new DrReplicationPublicationError("SUBSCRIPTION_DEFINITION_LOOKUP_INVALID");
  }
  return rows[0];
}

async function readSubscriptionRelations(database) {
  return database.$queryRawUnsafe(
    `select
       namespace.nspname as "schemaName",
       relation_class.relname as "tableName",
       subscription_relation.srsubstate::text as state
     from pg_catalog.pg_subscription subscription
     join pg_catalog.pg_subscription_rel subscription_relation
       on subscription_relation.srsubid = subscription.oid
     join pg_catalog.pg_class relation_class
       on relation_class.oid = subscription_relation.srrelid
     join pg_catalog.pg_namespace namespace
       on namespace.oid = relation_class.relnamespace
     where subscription.subname = $1
     order by namespace.nspname, relation_class.relname`,
    subscriptionName,
  );
}

async function readTableHasRows(database, table) {
  const rows = await database.$queryRawUnsafe(
    `select exists (
       select 1
       from ${quoteIdentifier("public")}.${quoteIdentifier(table)}
     ) as "hasRows"`,
  );
  return Array.isArray(rows) && rows.length === 1
    ? rows[0]?.hasRows
    : null;
}

async function verifyExactReplicationContract({
  primary: primaryDatabase,
  dr: drDatabase,
  columnsByTable,
  drDirectUrl: expectedDrDirectUrl,
  replicationUrl: expectedReplicationUrl,
}) {
  const assertExactMetadata = async () => {
    const [publicationDefinition, publicationRows, subscriptionDefinition] =
      await Promise.all([
        readPublicationDefinition(primaryDatabase),
        readPublicationTables(primaryDatabase),
        readSubscriptionDefinition(drDatabase),
      ]);
    assertPublicationContract({
      definition: publicationDefinition,
      allowlistedTables: replicatedPublicTables,
      publicationRows,
      columnsByTable,
      columnExclusions: replicationColumnExclusions,
      requireComplete: true,
    });
    assertSubscriptionContract({
      definition: subscriptionDefinition,
      publicationName,
      subscriptionName,
      drDirectUrl: expectedDrDirectUrl,
      primaryReplicationUrl: expectedReplicationUrl,
    });
  };

  await assertExactMetadata();
  const scope = await waitForSubscriptionScope({
    allowlistedTables: replicatedPublicTables,
    readRelations: () => readSubscriptionRelations(drDatabase),
    maxAttempts: 60,
    intervalMilliseconds: 1_000,
  });
  await assertExactMetadata();
  assertSubscriptionRelations({
    requiredTables: replicatedPublicTables,
    relationRows: scope.verifiedRelations.map(({ table, state }) => ({
      schemaName: "public",
      tableName: table,
      state,
    })),
  });
  return scope;
}
