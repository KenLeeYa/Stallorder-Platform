import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertAdditiveMigrationSql } from "../../scripts/lib/additive-migration-plan.mjs";

const migrationSource = readFileSync(fileURLToPath(new URL(
  "../migrations/20260826170000_daily_pickup_code_allocation.sql",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");

describe("daily pickup-code allocation migration", () => {
  it("remains additive and keeps the legacy order RPC intact", () => {
    expect(assertAdditiveMigrationSql(migrationSource)).toBe(true);
    expect(migrationSource).toContain("add column if not exists pickup_code_service_date date");
    expect(migrationSource).toContain("create function public.create_public_order_with_daily_pickup_code_targeted");
    expect(migrationSource).not.toMatch(/create\s+or\s+replace/i);
    expect(migrationSource).not.toMatch(/drop\s+function/i);
  });

  it("serializes allocation and only emits codes 001 through 999", () => {
    expect(migrationSource).toContain("pg_advisory_xact_lock");
    expect(migrationSource).toContain("generate_series(1, 999)");
    expect(migrationSource).toContain("lpad(v_candidate::text, 3, '0')");
    expect(migrationSource).toContain("pickup_code_display <> '000'");
    expect(migrationSource).toContain("extensions.digest(v_code, 'sha256')");
  });

  it("scopes uniqueness to the fulfillment business date and active takeaway orders", () => {
    expect(migrationSource).toContain("public.stall_business_date");
    expect(migrationSource).toContain("orders_active_pickup_code_service_date_key");
    expect(migrationSource).toContain("pickup_verified_at is null");
    expect(migrationSource).toContain("'COMPLETED'::public.order_status");
    expect(migrationSource).toContain("'CANCELLED'::public.order_status");
    expect(migrationSource).toContain("'EXPIRED'::public.order_status");
  });

  it("keeps allocation and reconciliation server-only", () => {
    expect(migrationSource).not.toMatch(/grant\s+execute[\s\S]*?to\s+(?:anon|authenticated)/i);
    expect(migrationSource.match(/to service_role;/g)).toHaveLength(3);
  });
});
