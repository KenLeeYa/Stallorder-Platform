import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureRemainingSnapshot, compareRemainingSnapshotReadOnly, remainingSnapshotQuery } from "./staging-partial-retirement-snapshot.mjs";
import { remainingSchemaQuery } from "./staging-partial-retirement-schema.mjs";

const query = vi.hoisted(() => vi.fn());
vi.mock("./dr-staging-conversion-plan.mjs", () => ({ conversionQuery: query }));
const tables = [{ schema: "public", name: "print_rules", columns: ["id"] }];
function snapshot(offline = true) {
  return {
    data: { inventory: [{ ...tables[0], kind: "r", partition: false, inheritance: 0 }],
      fingerprints: [{ table: "public.print_rules", rows: 0, digest: "d41d8cd98f00b204e9800998ecf8427e" }],
      offlineReferences: offline ? 3 : 0, retiredSchemas: 0 },
    schema: { version: 1, searchPath: '"$user", public', serverMajor: 17, retiredSchemas: 0, unsupported: 0,
      objects: [{ kind: "schema", identity: "public", definition: { owner: "postgres", acl: null } }],
      dependencies: [], sharedDependencies: [], sequences: [], sequenceStates: [] },
  };
}

describe("one-statement row/catalog evidence, never sequence atomicity or continuation authority", () => {
  beforeEach(() => { query.mockReset(); });

  it("compares replay-derived data and catalog in ONE fixed DR read-only response and exposes only evidence flags/counts", async () => {
    query.mockResolvedValue([{ remaining_snapshot: snapshot(false) }]);
    expect(await compareRemainingSnapshotReadOnly(snapshot(), tables)).toEqual({ diagnosticOnly: true,
      planQualified: false, remainingDataProven: false, remainingSchemaProven: false,
      remainingTableDataMatched: true, remainingCatalogMatched: true, sequenceStateMatched: true,
      rowCatalogSingleStatement: true, sequenceSnapshotAtomic: false, tableCount: 1, objectCount: 1, sequenceCount: 0 });
    expect(query).toHaveBeenCalledExactlyOnceWith(remainingSnapshotQuery(tables, [], false), true);
  });

  it("discovers sequence names offline but returns data/catalog from the same final statement", () => {
    const expected = snapshot();
    expected.schema.sequences = [{ schema: "public", name: "owned_id" }];
    expected.schema.sequenceStates = [{ schema: "public", name: "owned_id", value: "9007199254740993", called: false }];
    const discovery = { ...expected.schema, sequenceStates: [] };
    const sql = vi.fn().mockReturnValueOnce(JSON.stringify(discovery)).mockReturnValueOnce(JSON.stringify(expected));
    expect(captureRemainingSnapshot(sql, tables)).toEqual(expected);
    expect(sql.mock.calls).toEqual([[remainingSchemaQuery([])], [remainingSnapshotQuery(tables, expected.schema.sequences, true)]]);
    expect(query).not.toHaveBeenCalled();
    expect(() => captureRemainingSnapshot(() => "private decrypted row", tables))
      .toThrow(/^STAGING_PARTIAL_SNAPSHOT_CAPTURE_FAILED$/);
  });

  it("rejects either-side drift, malformed split responses and untrusted expected evidence without leaking SQL", async () => {
    for (const change of [s => { s.data.fingerprints[0].rows = 1; },
      s => { s.schema.objects[0].definition.owner = "other"; }, s => { s.data.offlineReferences = 3; }]) {
      const value = snapshot(false); change(value); query.mockResolvedValue([{ remaining_snapshot: value }]);
      await expect(compareRemainingSnapshotReadOnly(snapshot(), tables)).rejects.toThrow(/^STAGING_PARTIAL_(DATA|SCHEMA)_(MISMATCH|INVALID)$/);
    }
    for (const response of [[], [null], [{ remaining_snapshot: null }], [{ remaining_data: snapshot(false).data },
      { remaining_schema: snapshot().schema }], [{ remaining_snapshot: { ...snapshot(false), extra: "private" } }]]) {
      query.mockResolvedValue(response);
      await expect(compareRemainingSnapshotReadOnly(snapshot(), tables)).rejects.toThrow(/^STAGING_PARTIAL_SNAPSHOT_INVALID$/);
    }
    query.mockReset();
    await expect(compareRemainingSnapshotReadOnly(snapshot(false), tables)).rejects.toThrow(/^STAGING_PARTIAL_DATA_INVALID$/);
    expect(query).not.toHaveBeenCalled();
    query.mockRejectedValue(new Error("private provider SQL credentials"));
    await expect(compareRemainingSnapshotReadOnly(snapshot(), tables)).rejects.toThrow(/^STAGING_PARTIAL_SNAPSHOT_READ_FAILED$/);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("uses only qualified built-in data functions and no settings, transactions or mutations in the generated combined SELECT", () => {
    const sql = remainingSnapshotQuery(tables, [], false);
    expect(sql.match(/;/g)).toHaveLength(1);
    expect(sql).toContain("cross join (with");
    expect(sql).not.toMatch(/(?<![\w.])(?:json_build_object|json_agg|string_agg|row_to_json|count|md5)\(/);
    expect(sql).not.toMatch(/\b(begin|commit|set|insert|delete|update|truncate|drop|alter|create|nextval|setval)\s/i);
  });
});
