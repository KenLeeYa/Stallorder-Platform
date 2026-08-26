import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertAdditiveMigrationSql } from "../../scripts/lib/additive-migration-plan.mjs";

const migrationSource = readFileSync(fileURLToPath(new URL(
  "../migrations/20260826130000_competitive_module_channel_catalog.sql",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");

describe("competitive module and channel catalog migration", () => {
  it("passes the additive-only DR guard and leaves optional modules disabled", () => {
    expect(assertAdditiveMigrationSql(migrationSource)).toBe(true);
    for (const code of [
      "MODULE_GROWTH_ENABLED",
      "MODULE_OMNI_ENABLED",
      "MODULE_HQ_ENABLED",
      "MODULE_SUPPLY_LITE_ENABLED",
      "MODULE_EVENT_GROWTH_ENABLED",
      "MODULE_PUBLIC_API_ENABLED",
      "MODULE_ADVANCED_ANALYTICS_ENABLED",
    ]) {
      expect(migrationSource).toMatch(new RegExp(`'${code}',[^\\n]*false, false`));
    }
  });

  it("keeps catalog access server-authoritative instead of exposing tables to browser roles", () => {
    expect(migrationSource).not.toMatch(/grant\s+select[\s\S]*?to\s+authenticated/i);
    expect(migrationSource).not.toMatch(/create\s+policy[\s\S]*?to\s+authenticated/i);
    expect(migrationSource).toContain("from public, anon, authenticated");
    expect(migrationSource.match(/to service_role;/g)).toHaveLength(4);
  });

  it("forces RLS, service-role writes, backend fencing and immutable draft content", () => {
    expect(migrationSource.match(/force row level security/g)).toHaveLength(4);
    expect(migrationSource.match(/create trigger backend_writable_guard/g)).toHaveLength(4);
    expect(migrationSource).toContain("CATALOG_VERSION_CONTENT_LOCKED");
    expect(migrationSource).toContain("CATALOG_VERSION_TRANSITION_INVALID");
    expect(migrationSource).not.toContain("session_replication_role");
  });
});
