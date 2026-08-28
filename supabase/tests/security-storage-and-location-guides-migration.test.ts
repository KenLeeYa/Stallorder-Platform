import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { assertAdditiveMigrationSql } from "../../scripts/lib/additive-migration-plan.mjs";

const migrationSource = readFileSync(fileURLToPath(new URL(
  "../migrations/20260828170000_security_storage_and_location_guides.sql",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");

describe("security storage and location-guide migration", () => {
  it("passes the additive-only deployment contract", () => {
    expect(assertAdditiveMigrationSql(migrationSource)).toBe(true);
  });

  it("creates bounded leases, deletion tombstones, and scheduled alert state", () => {
    expect(migrationSource).toContain("create table public.catalog_image_uploads");
    expect(migrationSource).toContain("expires_at timestamptz not null");
    expect(migrationSource).toContain("add column if not exists deleted_at timestamptz");
    expect(migrationSource).toContain("create table public.operational_alert_refresh_states");
    expect(migrationSource).toContain("refresh_operational_alerts_bounded");
    expect(migrationSource).toContain("orders.created_at >= now() - interval '24 hours'");
  });

  it("keeps the new internal tables service-role only and backend fenced", () => {
    expect(migrationSource.match(/create trigger backend_writable_guard/g)).toHaveLength(2);
    expect(migrationSource).toContain(
      "revoke all on table public.catalog_image_uploads from public, anon, authenticated",
    );
    expect(migrationSource).toContain(
      "revoke all on table public.operational_alert_refresh_states from public, anon, authenticated",
    );
    expect(migrationSource).not.toMatch(/grant[\s\S]*?to\s+(?:anon|authenticated)/i);
  });
});
