// One SELECT for row/catalog MVCC consistency. PostgreSQL sequence state is
// non-MVCC: a single statement MUST NOT be described as an atomic sequence proof.
import { isDeepStrictEqual } from "node:util";
import { conversionQuery } from "./dr-staging-conversion-plan.mjs";
import { remainingDataQuery, validateRemainingData, matchRemainingData } from "./staging-partial-retirement-data.mjs";
import { remainingSchemaQuery, validateRemainingSchema, matchRemainingSchema } from "./staging-partial-retirement-schema.mjs";

function requireSnapshot(condition) { if (!condition) throw new Error("STAGING_PARTIAL_SNAPSHOT_INVALID"); }

// Only our two generators supply SQL; no caller expressions or target override.
export function remainingSnapshotQuery(tables, sequences, offline) {
  const data = remainingDataQuery(tables, offline).replace(/;$/, "");
  const schema = remainingSchemaQuery(sequences).replace(/;$/, "");
  return `select pg_catalog.json_build_object('data',d.remaining_data,'schema',s.remaining_schema)
    as remaining_snapshot from (${data}) d cross join (${schema}) s;`;
}

function validateSnapshot(value, tables, offline) {
  requireSnapshot(value && isDeepStrictEqual(Object.keys(value).sort(), ["data", "schema"]));
  validateRemainingData(value.data, tables, offline);
  validateRemainingSchema(value.schema);
  return value;
}

// The preliminary catalog is only for sequence name discovery. Neither its
// definitions nor a separately captured table snapshot become final evidence.
export function captureRemainingSnapshot(sql, tables) {
  try {
    const discovery = validateRemainingSchema(JSON.parse(sql(remainingSchemaQuery([]))), false);
    return validateSnapshot(JSON.parse(sql(remainingSnapshotQuery(tables, discovery.sequences, true))), tables, true);
  } catch { throw new Error("STAGING_PARTIAL_SNAPSHOT_CAPTURE_FAILED"); }
}

export async function compareRemainingSnapshotReadOnly(expected, tables) {
  validateSnapshot(expected, tables, true);
  let rows;
  try { rows = await conversionQuery(remainingSnapshotQuery(tables, expected.schema.sequences, false), true); }
  catch { throw new Error("STAGING_PARTIAL_SNAPSHOT_READ_FAILED"); }
  requireSnapshot(Array.isArray(rows) && rows.length === 1
    && rows[0] && isDeepStrictEqual(Object.keys(rows[0]), ["remaining_snapshot"]));
  const actual = validateSnapshot(rows[0].remaining_snapshot, tables, false);
  return { ...matchRemainingData(expected.data, actual.data, tables),
    ...matchRemainingSchema(expected.schema, actual.schema),
    rowCatalogSingleStatement: true, sequenceSnapshotAtomic: false };
}
