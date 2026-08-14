import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertAdditiveMigrationSql } from "../../scripts/lib/additive-migration-plan.mjs";

const migrationSource = readFileSync(fileURLToPath(new URL(
  "../migrations/20260813133000_global_stall_code_guard.sql",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");

describe("global public storefront identifier guard migration", () => {
  it("passes the additive-only DR migration guard", () => {
    expect(assertAdditiveMigrationSql(migrationSource)).toBe(true);
  });

  it("creates a non-unique lookup index without risking DR replication", () => {
    expect(migrationSource).toContain([
      "create index if not exists stalls_code_lower_lookup_idx",
      "on public.stalls ((lower(code)));",
    ].join("\n"));
    expect(migrationSource).not.toMatch(/create\s+unique\s+index/i);
  });

  it("serializes normalized codes and rejects existing cross-organization matches", () => {
    expect(migrationSource).toContain("security definer\nset search_path = ''");
    expect(migrationSource).toContain("pg_catalog.pg_advisory_xact_lock(");
    expect(migrationSource).toContain("pg_catalog.hashtextextended(normalized_code, 0)");
    expect(migrationSource).toContain("pg_catalog.lower(existing_stall.code) = normalized_code");
    expect(migrationSource).toContain("existing_stall.id is distinct from new.id");
    expect(migrationSource).toContain("constraint = 'stalls_code_lower_guard'");
    expect(migrationSource).toContain([
      "create trigger stalls_validate_global_code_before_write",
      "before insert or update on public.stalls",
      "for each row execute function public.enforce_global_stall_code_guard();",
    ].join("\n"));
    expect("stalls_validate_global_code_before_write".localeCompare(
      "stalls_sync_foundation_before_write",
    )).toBeGreaterThan(0);
  });

  it("does not rewrite legacy slugs or stall data", () => {
    expect(migrationSource).not.toMatch(/\bupdate\s+public\.stalls\b/i);
    expect(migrationSource).not.toMatch(/\bdelete\s+from\s+public\.stalls\b/i);
    expect(migrationSource).not.toMatch(/\bslug\b/i);
  });
});
