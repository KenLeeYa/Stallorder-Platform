import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertAdditiveMigrationSql } from "../../scripts/lib/additive-migration-plan.mjs";

const migrationSource = readFileSync(fileURLToPath(new URL(
  "../migrations/20260829120000_workforce_supply_profit_foundation.sql",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");

describe("workforce, supply and operating profit foundation migration", () => {
  it("is additive and keeps merchant accounting tables backend-only", () => {
    expect(assertAdditiveMigrationSql(migrationSource)).toBe(true);
    expect(migrationSource).not.toMatch(/grant\s+select[\s\S]*?to\s+authenticated/i);
    expect(migrationSource).toContain("force row level security");
    expect(migrationSource).toContain("app_private.enforce_backend_writable()");
    expect(migrationSource).not.toContain("session_replication_role");
  });

  it("adds payroll, scheduling and leave audit records", () => {
    for (const table of [
      "workforce_payroll_policies",
      "workforce_wage_rates",
      "workforce_schedules",
      "workforce_leave_requests",
      "workforce_holiday_rules",
      "workforce_payroll_periods",
      "workforce_payroll_lines",
    ]) {
      expect(migrationSource).toContain(`create table public.${table}`);
    }
    expect(migrationSource).toContain("calculation_snapshot jsonb");
    expect(migrationSource).toContain("multiplier_bps");
  });

  it("adds suppliers, purchasing, freshness lots and operating expenses", () => {
    for (const table of [
      "supply_suppliers",
      "supply_purchase_orders",
      "supply_purchase_order_lines",
      "supply_inventory_lots",
      "operating_expenses",
    ]) {
      expect(migrationSource).toContain(`create table public.${table}`);
    }
    expect(migrationSource).toContain("track_expiry boolean");
    expect(migrationSource).toContain("supply_inventory_lots_expiry_idx");
  });
});
