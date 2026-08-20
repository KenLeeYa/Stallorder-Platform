import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertAdditiveMigrationSql } from "../../scripts/lib/additive-migration-plan.mjs";

const migrationSource = readFileSync(fileURLToPath(new URL(
  "../migrations/20260813194500_future_fulfillment_production_load.sql",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");

describe("future fulfillment production load migration", () => {
  it("passes the additive-only DR migration guard", () => {
    expect(assertAdditiveMigrationSql(migrationSource)).toBe(true);
  });

  it("replaces both function bodies in place so existing dependencies retain identity", () => {
    expect(migrationSource).toContain(
      "create or replace function public.refresh_kds_operational_alerts(",
    );
    expect(migrationSource).toContain(
      "create or replace function public.calculate_stall_capacity(",
    );
    expect(migrationSource).not.toMatch(/\balter\s+function\b/i);
    expect(migrationSource).not.toContain("_legacy_20260813");
    expect(migrationSource).not.toMatch(/\b(?:revoke|grant)\b/i);
  });

  it("rejects any change outside the hash-bound reviewed function migration", () => {
    expect(() => assertAdditiveMigrationSql(
      migrationSource.replace("v_critical_minutes integer;", "v_critical_minutes bigint;"),
    )).toThrow("FUNCTION_REPLACEMENT_EXISTING_OBJECT_FORBIDDEN");
  });

  it("excludes unstarted future business dates while retaining started work", () => {
    expect(migrationSource.match(/orders\.committed_fulfillment_at/g)?.length).toBeGreaterThanOrEqual(6);
    expect(migrationSource.match(/public\.stall_business_date\(/g)?.length).toBeGreaterThanOrEqual(12);
    expect(migrationSource).toContain("greatest(\n              coalesce(orders.confirmed_at, orders.created_at)");
    expect(migrationSource.match(/orders\.status in \('PREPARING', 'PACKING'\)\n\s+or public\.stall_business_date/g)?.length).toBeGreaterThanOrEqual(4);
    expect(migrationSource.match(/then coalesce\(task\.started_at, orders\.confirmed_at, orders\.created_at\)/g)?.length).toBe(2);
    expect(migrationSource).toContain("v_order_count, v_item_count, v_weighted_load");
    expect(migrationSource).toContain("current_window as (");
    expect(migrationSource).toContain([
      "orders.status in (",
      "          'PREPARING'::public.order_status,",
      "          'PACKING'::public.order_status",
      "        )",
      "        or (",
      "          public.stall_business_date(",
    ].join("\n"));
  });
});
