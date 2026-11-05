import { beforeEach, describe, expect, it, vi } from "vitest";
import { remainingDataQuery, validateRemainingData, compareRemainingDataReadOnly } from "./staging-partial-retirement-data.mjs";

const query = vi.hoisted(() => vi.fn());
vi.mock("./dr-staging-conversion-plan.mjs", () => ({ conversionQuery: query }));
const tables = [
  { schema: "public", name: "print_rules", columns: ["id", "printer_id"] },
  { schema: "storage", name: "objects", columns: ["bucket_id", "name"] },
  { schema: "app_private", name: "retired", columns: ["id"] },
];
function snapshot(offline = false) {
  return { inventory: tables.slice(0, 2).map(table => ({ ...structuredClone(table), kind: "r", partition: false, inheritance: 0 })),
    fingerprints: tables.slice(0, 2).map(table => ({ table: `${table.schema}.${table.name}`, rows: 0,
      digest: "d41d8cd98f00b204e9800998ecf8427e" })), offlineReferences: offline ? 3 : 0, retiredSchemas: 0 };
}

describe("remaining original table data, never continuation authority", () => {
  beforeEach(() => { query.mockReset(); });

  it("reads all surviving source columns atomically and excludes the three parent rows ONLY offline", () => {
    const offline = remainingDataQuery(tables, true);
    const hosted = remainingDataQuery(tables, false);
    expect(offline).toContain('select "id","printer_id" from "public"."print_rules" where id not in');
    expect(hosted).toContain('select "id","printer_id" from "public"."print_rules"');
    expect(hosted).not.toContain("where id not in");
    expect(hosted).not.toContain('from "app_private"."retired"');
    expect(hosted).toContain("pg_catalog.pg_attribute");
    expect(hosted).toContain("retiredSchemas");
    expect(hosted).not.toMatch(/\b(insert|update|delete|truncate|drop|alter|create|set|call|do)\b/i);
  });

  it("fails closed on extra or missing tables/columns and unsupported inherited, foreign or partitioned data", () => {
    for (const change of [
      s => { s.inventory.push({ ...s.inventory[0], name: "extra" }); },
      s => { s.inventory.pop(); }, s => { s.inventory[0].columns.reverse(); },
      s => { s.inventory[0].columns.push("new_column"); },
      s => { s.inventory[0].kind = "f"; }, s => { s.inventory[0].partition = true; },
      s => { s.inventory[0].inheritance = 1; }, s => { s.retiredSchemas = 1; },
      s => { s.fingerprints.push(s.fingerprints[0]); }, s => { s.fingerprints[0].rows = -1; },
      s => { s.fingerprints[0].digest = "private data"; },
    ]) {
      const value = snapshot(true); change(value);
      expect(() => validateRemainingData(value, tables, true)).toThrow(/^STAGING_PARTIAL_DATA_INVALID$/);
    }
  });

  it("uses the fixed DR read-only transport, compares the replayed data and never claims schema or full equivalence", async () => {
    query.mockResolvedValue([{ remaining_data: snapshot() }]);
    expect(await compareRemainingDataReadOnly(snapshot(true), tables)).toEqual({ diagnosticOnly: true,
      planQualified: false, remainingDataProven: false, remainingTableDataMatched: true,
      remainingSchemaProven: false, tableCount: 2 });
    expect(query).toHaveBeenCalledExactlyOnceWith(remainingDataQuery(tables, false), true);
  });

  it("rejects a changed row hash or count and never hides hosted rows matching the offline reference IDs", async () => {
    for (const change of [s => { s.fingerprints[0].digest = "a".repeat(32); },
      s => { s.fingerprints[0].rows = 1; }, s => { s.offlineReferences = 3; }]) {
      const value = snapshot(); change(value); query.mockResolvedValue([{ remaining_data: value }]);
      await expect(compareRemainingDataReadOnly(snapshot(true), tables)).rejects.toThrow(/^STAGING_PARTIAL_DATA_(MISMATCH|INVALID)$/);
    }
  });

  it("refuses invalid expected evidence before network and sanitizes failed/malformed hosted responses", async () => {
    await expect(compareRemainingDataReadOnly(snapshot(), tables)).rejects.toThrow(/^STAGING_PARTIAL_DATA_INVALID$/);
    expect(query).not.toHaveBeenCalled();
    for (const value of [[], [{ remaining_data: "private row" }], [{ remaining_data: snapshot() }, {}]]) {
      query.mockResolvedValue(value);
      await expect(compareRemainingDataReadOnly(snapshot(true), tables)).rejects.toThrow(/^STAGING_PARTIAL_DATA_INVALID$/);
    }
    query.mockRejectedValue(new Error("provider secret SQL"));
    await expect(compareRemainingDataReadOnly(snapshot(true), tables)).rejects.toThrow(/^STAGING_PARTIAL_DATA_READ_FAILED$/);
  });

  it("rejects invalid source projections instead of generating arbitrary SQL", () => {
    for (const value of [[], [...tables, tables[0]], [{ ...tables[0], schema: "pg_catalog" }],
      [{ ...tables[0], columns: ["id", "id"] }], [{ ...tables[0], name: "bad\0name" }]]) {
      expect(() => remainingDataQuery(value, true)).toThrow(/^STAGING_PARTIAL_DATA_INVALID$/);
    }
    const odd = [{ schema: "public", name: "print_rules", columns: ["id", "x\"; select 'private'"] }];
    expect(remainingDataQuery(odd, true)).toContain('"x""; select \'private\'"');
  });
});
