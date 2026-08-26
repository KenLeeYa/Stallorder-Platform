import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertAdditiveMigrationSql } from "../../scripts/lib/additive-migration-plan.mjs";

const migrationSource = readFileSync(fileURLToPath(new URL(
  "../migrations/20260826133000_supply_lite_foundation.sql",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");

describe("supply lite foundation migration", () => {
  it("is additive-only and remains server-authoritative", () => {
    expect(assertAdditiveMigrationSql(migrationSource)).toBe(true);
    expect(migrationSource).not.toMatch(/grant\s+select[\s\S]*?to\s+authenticated/i);
    expect(migrationSource).not.toMatch(/create\s+policy[\s\S]*?to\s+authenticated/i);
    expect(migrationSource).toContain("from public, anon, authenticated");
    expect(migrationSource.match(/to service_role;/g)).toHaveLength(5);
  });

  it("creates scoped ingredient, location, recipe, balance and movement records", () => {
    for (const table of [
      "supply_ingredients",
      "supply_locations",
      "supply_recipe_components",
      "supply_inventory_balances",
      "supply_inventory_movements",
    ]) {
      expect(migrationSource).toContain(`create table public.${table}`);
    }
    expect(migrationSource.match(/force row level security/g)).toHaveLength(5);
    expect(migrationSource.match(/create trigger backend_writable_guard/g)).toHaveLength(5);
  });

  it("keeps movement history immutable and idempotent", () => {
    expect(migrationSource).toContain("SUPPLY_MOVEMENT_IMMUTABLE");
    expect(migrationSource).toContain("supply_inventory_movements_idempotency_key");
    expect(migrationSource).toContain("quantity_delta_micros <> 0");
    expect(migrationSource).not.toContain("session_replication_role");
  });
});
