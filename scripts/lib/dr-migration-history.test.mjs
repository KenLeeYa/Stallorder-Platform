import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertMigrationHistoriesCompatible,
  isApprovedHistoricalMetadataRewrite,
  modernMigrationMetadataFrom,
} from "./dr-migration-history.mjs";

const migrationDirectory = new URL("../../supabase/migrations/", import.meta.url);

function repositoryHistory() {
  return readdirSync(migrationDirectory)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => {
      const match = /^(\d{14})_(.+)\.sql$/.exec(file);
      if (!match) throw new Error(`Unexpected migration filename: ${file}`);
      return {
        version: match[1],
        name: match[2],
        statements: [`statement:${match[1]}`],
      };
    });
}

describe("DR migration history compatibility", () => {
  it("accepts the locked legacy identity and exact modern metadata", () => {
    const primary = repositoryHistory();
    const dr = structuredClone(primary);

    expect(() => assertMigrationHistoriesCompatible(primary, dr)).not.toThrow();
  });

  it("accepts legacy whole-file versus split statement bookkeeping", () => {
    const primary = repositoryHistory();
    const dr = structuredClone(primary);
    const legacyIndex = dr.findIndex(
      (row) => row.version < modernMigrationMetadataFrom,
    );
    primary[legacyIndex].statements = ["legacy statement one; legacy statement two;"];
    dr[legacyIndex].statements = ["legacy statement one;", "legacy statement two;"];

    expect(() => assertMigrationHistoriesCompatible(primary, dr)).not.toThrow();
  });

  it("rejects modern statement metadata drift", () => {
    const primary = repositoryHistory();
    const dr = structuredClone(primary);
    const modernIndex = dr.findIndex(
      (row) => row.version === modernMigrationMetadataFrom,
    );
    dr[modernIndex].statements = ["different modern statement"];

    expect(() => assertMigrationHistoriesCompatible(primary, dr))
      .toThrowError("MIGRATION_HISTORY_MISMATCH");
  });

  it("accepts only the audited Primary-to-DR metadata rewrite digests", () => {
    expect(isApprovedHistoricalMetadataRewrite({
      version: "20260813133000",
      name: "global_stall_code_guard",
      primaryStatementCount: 5,
      drStatementCount: 5,
      primaryStatementsDigest:
        "679d775e2d96f5d39621c2a0735681b399e88c2094becc34b1dde4197a9e6a5e",
      drStatementsDigest:
        "40cf03d0d1a17ae76143e9d0cb9daa6d5654c2f2af7796a3e170c3f002a28322",
    })).toBe(true);
    expect(isApprovedHistoricalMetadataRewrite({
      version: "20260813194500",
      name: "future_fulfillment_production_load",
      primaryStatementCount: 12,
      drStatementCount: 4,
      primaryStatementsDigest:
        "c670716986a01f7264a8d5b8bd9661336eff3117645183e5552c49d3a752099c",
      drStatementsDigest:
        "8da438dd906ae98d706758bc354b507bf89c39f9410872a1a051c37de8d8efc3",
    })).toBe(true);
    expect(isApprovedHistoricalMetadataRewrite({
      version: "20260813194500",
      name: "future_fulfillment_production_load",
      primaryStatementCount: 12,
      drStatementCount: 4,
      primaryStatementsDigest: "0".repeat(64),
      drStatementsDigest:
        "8da438dd906ae98d706758bc354b507bf89c39f9410872a1a051c37de8d8efc3",
    })).toBe(false);
  });

  it.each([
    ["missing", (rows) => rows.slice(1)],
    ["renamed", (rows) => rows.map((row, index) => (
      index === 0 ? { ...row, name: "renamed" } : row
    ))],
  ])("rejects a %s migration identity", (_case, change) => {
    const primary = repositoryHistory();
    const dr = change(structuredClone(primary));

    expect(() => assertMigrationHistoriesCompatible(primary, dr))
      .toThrowError(/MIGRATION_HISTORY_(?:INVALID|MISMATCH)/);
  });

  it.each([
    ["duplicate", (rows) => rows.with(1, { ...rows[0] })],
    ["out-of-order", (rows) => rows.with(1, rows[2]).with(2, rows[1])],
    ["malformed", (rows) => rows.with(0, { ...rows[0], version: "invalid" })],
  ])("rejects %s history without exposing statement text", (_case, change) => {
    const sentinel = "TOP_SECRET_MIGRATION_STATEMENT_SENTINEL";
    const primary = repositoryHistory();
    primary[0].statements = [sentinel];
    const dr = change(structuredClone(primary));

    let failure;
    try {
      assertMigrationHistoriesCompatible(primary, dr);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(JSON.stringify(failure)).not.toContain(sentinel);
    expect(failure.message).toBe("MIGRATION_HISTORY_INVALID");
  });
});
