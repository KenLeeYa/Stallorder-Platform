// A row-data slice only. The protected composition must derive its expected
// snapshot from authenticated original backup + replay, never today's DR state.
import { isDeepStrictEqual } from "node:util";
import { conversionQuery } from "./dr-staging-conversion-plan.mjs";

const sourceSchemas = ["public", "auth", "storage", "vault", "app_private", "internal"];
const retiredSchemas = ["app_private", "internal"];
const recoveryIds = ["14e82b29-5b3c-4b8a-819a-f0a16f9db2fd", "ce425c1e-c149-42e0-83b3-590268772896",
  "f66584a9-6357-4422-8cda-40c8a13c259d"];
const identifier = value => `"${value.replaceAll('"', '""')}"`;
const literal = value => `'${value.replaceAll("'", "''")}'`;
const canonical = values => [...values].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const validName = value => typeof value === "string" && value.length > 0 && !value.includes("\0")
  && Buffer.byteLength(value) <= 63;
function requireData(condition) { if (!condition) throw new Error("STAGING_PARTIAL_DATA_INVALID"); }

function remainingTables(tables) {
  requireData(Array.isArray(tables) && tables.length > 0 && tables.length <= 239
    && tables.every(table => table && sourceSchemas.includes(table.schema) && validName(table.name)
      && Array.isArray(table.columns) && table.columns.length > 0 && table.columns.length <= 1600
      && table.columns.every(validName) && new Set(table.columns).size === table.columns.length)
    && new Set(tables.map(table => `${table.schema}.${table.name}`)).size === tables.length
    && tables.some(table => table.schema === "public" && table.name === "print_rules" && table.columns.includes("id")));
  return tables.filter(table => !retiredSchemas.includes(table.schema));
}

// One SELECT gives data and catalog reads the same database snapshot. No views,
// mutations, session settings, dynamic SQL, or caller-provided expressions.
export function remainingDataQuery(tables, offline) {
  requireData(typeof offline === "boolean");
  const remaining = remainingTables(tables);
  const projection = remaining.map(({ schema, name, columns }) => `select pg_catalog.json_build_object(
    'table',${literal(`${schema}.${name}`)},'rows',pg_catalog.count(*),'digest',
    pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.md5(pg_catalog.row_to_json(t)::pg_catalog.text),'' order by pg_catalog.md5(pg_catalog.row_to_json(t)::pg_catalog.text)),''))) as fingerprint
    from (select ${columns.map(identifier).join(",")} from ${identifier(schema)}.${identifier(name)}${offline && schema === "public" && name === "print_rules"
      ? ` where id not in (${recoveryIds.map(literal).join(",")})` : ""}) t`).join(" union all ");
  return `select pg_catalog.json_build_object(
    'inventory',(select coalesce(pg_catalog.json_agg(pg_catalog.json_build_object('schema',n.nspname,'name',c.relname,
      'columns',(select pg_catalog.json_agg(a.attname order by a.attnum) from pg_catalog.pg_attribute a
        where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
      'kind',c.relkind,'partition',c.relispartition,
      'inheritance',(select pg_catalog.count(*) from pg_catalog.pg_inherits where inhrelid=c.oid or inhparent=c.oid))),'[]')
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname in (${sourceSchemas.map(literal).join(",")}) and c.relkind in ('r','p','f')),
    'fingerprints',(select pg_catalog.json_agg(f.fingerprint) from (${projection}) f),
    'offlineReferences',(select pg_catalog.count(*) from public.print_rules where id in (${recoveryIds.map(literal).join(",")})),
    'retiredSchemas',(select pg_catalog.count(*) from pg_catalog.pg_namespace where nspname in ('app_private','internal'))
  ) as remaining_data;`;
}

// Private in-memory snapshot: do not print/upload table hashes or row data.
// Catalog validation here covers table identity/ordered columns, NOT full schema.
export function validateRemainingData(snapshot, tables, offline) {
  const remaining = remainingTables(tables);
  requireData(typeof offline === "boolean" && snapshot && snapshot.retiredSchemas === 0
    && snapshot.offlineReferences === (offline ? 3 : 0)
    && isDeepStrictEqual(Object.keys(snapshot).sort(), ["fingerprints", "inventory", "offlineReferences", "retiredSchemas"])
    && Array.isArray(snapshot.inventory) && snapshot.inventory.every(item => item && typeof item === "object")
    && Array.isArray(snapshot.fingerprints) && snapshot.fingerprints.every(item => item && typeof item === "object"));
  const inventory = remaining.map(({ schema, name, columns }) => ({ schema, name, columns, kind: "r", partition: false, inheritance: 0 }));
  requireData(isDeepStrictEqual(canonical(snapshot.inventory), canonical(inventory))
    && snapshot.fingerprints.length === remaining.length
    && isDeepStrictEqual(snapshot.fingerprints.map(item => item.table).sort(), remaining.map(table => `${table.schema}.${table.name}`).sort())
    && snapshot.fingerprints.every(item => isDeepStrictEqual(Object.keys(item).sort(), ["digest", "rows", "table"])
      && Number.isSafeInteger(item.rows) && item.rows >= 0 && /^[a-f0-9]{32}$/.test(item.digest)));
  return snapshot;
}

// Only a fixed retired-DR read through the existing read_only transport. There
// is no target parameter, local fallback, retry, reset, or provider write.
export async function compareRemainingDataReadOnly(expected, tables) {
  validateRemainingData(expected, tables, true);
  let rows;
  try { rows = await conversionQuery(remainingDataQuery(tables, false), true); }
  catch { throw new Error("STAGING_PARTIAL_DATA_READ_FAILED"); }
  requireData(Array.isArray(rows) && rows.length === 1);
  return matchRemainingData(expected, rows[0]?.remaining_data, tables);
}

export function matchRemainingData(expected, value, tables) {
  validateRemainingData(expected, tables, true);
  const actual = validateRemainingData(value, tables, false);
  if (!isDeepStrictEqual(canonical(actual.fingerprints), canonical(expected.fingerprints))) {
    throw new Error("STAGING_PARTIAL_DATA_MISMATCH");
  }
  return { diagnosticOnly: true, planQualified: false, remainingDataProven: false,
    remainingTableDataMatched: true, remainingSchemaProven: false, tableCount: actual.fingerprints.length };
}
