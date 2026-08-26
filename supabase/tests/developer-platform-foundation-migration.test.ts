import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertAdditiveMigrationSql } from "../../scripts/lib/additive-migration-plan.mjs";

const migrationSource = readFileSync(fileURLToPath(new URL(
  "../migrations/20260826140000_developer_platform_foundation.sql",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");

describe("developer platform foundation migration", () => {
  it("is additive-only and browser roles cannot read credentials", () => {
    expect(assertAdditiveMigrationSql(migrationSource)).toBe(true);
    expect(migrationSource).not.toMatch(/grant\s+select[\s\S]*?to\s+authenticated/i);
    expect(migrationSource).not.toMatch(/create\s+policy[\s\S]*?to\s+authenticated/i);
    expect(migrationSource).toContain("from public, anon, authenticated");
    expect(migrationSource.match(/to service_role;/g)).toHaveLength(3);
  });

  it("stores API hashes and Vault references without raw secrets or payloads", () => {
    expect(migrationSource).toContain("create table public.public_api_clients");
    expect(migrationSource).toContain("key_hash text not null");
    expect(migrationSource).not.toMatch(/raw_(?:key|secret|payload)/i);
    expect(migrationSource).toContain("secret_reference uuid not null");
    expect(migrationSource).toContain("payload_hash text not null");
  });

  it("forces RLS, backend fencing and webhook delivery idempotency", () => {
    expect(migrationSource.match(/force row level security/g)).toHaveLength(3);
    expect(migrationSource.match(/create trigger backend_writable_guard/g)).toHaveLength(3);
    expect(migrationSource).toContain("outbound_webhook_deliveries_event_key");
    expect(migrationSource).not.toContain("session_replication_role");
  });
});
