import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertMigrationHistoriesCompatible,
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
