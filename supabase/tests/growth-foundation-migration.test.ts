import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertAdditiveMigrationSql } from "../../scripts/lib/additive-migration-plan.mjs";

const migrationSource = readFileSync(fileURLToPath(new URL(
  "../migrations/20260826150000_growth_foundation.sql",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");

const tables = [
  "growth_coupon_campaigns",
  "growth_coupon_issuances",
  "growth_coupon_redemptions",
  "growth_stamp_programs",
  "growth_stamp_accounts",
  "growth_stamp_ledger",
  "growth_referral_programs",
  "growth_referral_links",
  "growth_referral_conversions",
  "growth_rfm_snapshots",
  "growth_automation_flows",
  "growth_automation_runs",
] as const;

describe("growth foundation migration", () => {
  it("is additive and creates every governed growth ledger", () => {
    expect(assertAdditiveMigrationSql(migrationSource)).toBe(true);
    for (const table of tables) expect(migrationSource).toContain(`create table public.${table}`);
  });

  it("keeps customer and campaign data server-authoritative", () => {
    expect(migrationSource).not.toMatch(/grant\s+select[\s\S]*?to\s+authenticated/i);
    expect(migrationSource).not.toMatch(/create\s+policy[\s\S]*?to\s+authenticated/i);
    expect(migrationSource.match(/force row level security/g)).toHaveLength(tables.length);
    expect(migrationSource.match(/create trigger backend_writable_guard/g)).toHaveLength(tables.length);
    expect(migrationSource.match(/to service_role;/g)).toHaveLength(tables.length);
  });

  it("uses immutable, idempotent coupon and stamp entries", () => {
    expect(migrationSource).toContain("GROWTH_LEDGER_IMMUTABLE");
    expect(migrationSource).toContain("growth_coupon_redemptions_event_key");
    expect(migrationSource).toContain("growth_stamp_ledger_event_key");
    expect(migrationSource).toContain("consent_purpose_code");
    expect(migrationSource).toContain("dry_run boolean not null default true");
    expect(migrationSource).not.toContain("session_replication_role");
  });
});
