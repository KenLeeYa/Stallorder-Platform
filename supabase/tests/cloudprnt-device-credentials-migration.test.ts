import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertAdditiveMigrationSql } from "../../scripts/lib/additive-migration-plan.mjs";

const migration = readFileSync(join(
  process.cwd(),
  "supabase/migrations/20260903120000_cloudprnt_device_credentials.sql",
), "utf8");

describe("CloudPRNT device credential migration", () => {
  it("passes the protected additive migration classifier", () => {
    expect(assertAdditiveMigrationSql(migration)).toBe(true);
  });

  it("adds per-printer identity, hashed secret storage, rotation metadata, and uniqueness", () => {
    expect(migration).toMatch(/add column if not exists device_id text/i);
    expect(migration).toMatch(/add column if not exists device_token_hash text/i);
    expect(migration).toMatch(/add column if not exists credential_version integer not null default 0/i);
    expect(migration).toMatch(/add column if not exists credential_rotated_at timestamptz/i);
    expect(migration).toMatch(/create unique index if not exists printers_device_id_key/i);
    expect(migration).toMatch(/device_token_hash ~ '\^\[0-9a-f\]\{64\}\$'/i);
  });

  it("does not store a raw token column or mutate existing printer rows", () => {
    expect(migration).not.toMatch(/device_token(?!_hash)/i);
    expect(migration).not.toMatch(/\b(update|delete|truncate)\s+public\.printers\b/i);
  });
});
