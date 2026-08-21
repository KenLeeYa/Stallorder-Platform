import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationSource = normalizeLineEndings(readFileSync(fileURLToPath(new URL(
  "../migrations/20260821012144_dynamic_ordering_qr_foundation.sql",
  import.meta.url,
)), "utf8"));

function normalizeLineEndings(value: string) {
  return value.replace(/\r\n/g, "\n");
}

function extractFunction(signature: string) {
  const start = [
    migrationSource.indexOf(`create function ${signature}`),
    migrationSource.indexOf(`create or replace function ${signature}`),
  ].filter((index) => index >= 0).sort((left, right) => left - right)[0] ?? -1;
  const end = migrationSource.indexOf("\n$$;", start);
  if (start < 0 || end < 0) throw new Error(`FUNCTION_NOT_FOUND:${signature}`);
  return migrationSource.slice(start, end + 4);
}

describe("dynamic ordering QR foundation migration", () => {
  it("ships disabled and preserves the printed static QR entry", () => {
    expect(migrationSource).toContain("'DYNAMIC_ORDERING_QR_FOUNDATION_ENABLED'");
    expect(migrationSource).toMatch(
      /'DYNAMIC_ORDERING_QR_FOUNDATION_ENABLED',[\s\S]*?false,[\s\S]*?false/,
    );
    expect(migrationSource).not.toMatch(
      /update public\.resilience_feature_flags[\s\S]*default_enabled\s*=\s*true/i,
    );
    expect(migrationSource).not.toMatch(/alter table public\.qr_codes/i);
    expect(migrationSource).not.toMatch(/(?:update|delete from) public\.qr_codes/i);
  });

  it("stores only hashes and binds every credential to its tenant ordering scope", () => {
    expect(migrationSource).toContain("create table public.dynamic_qr_service_points");
    expect(migrationSource).toContain("create table public.dynamic_qr_credentials");
    expect(migrationSource).toContain("token_hash text not null unique");
    expect(migrationSource).toContain("nonce_hash text not null unique");
    expect(migrationSource).not.toMatch(/\n\s*(?:token|nonce) text/i);
    for (const column of [
      "organization_id",
      "stall_id",
      "dining_table_id",
      "static_qr_code_id",
      "order_session_id",
      "credential_version",
      "expires_at",
      "device_hash",
    ]) {
      expect(migrationSource).toContain(column);
    }
    expect(migrationSource).toContain("DYNAMIC_QR_SCOPE_MISMATCH");
  });

  it("keeps a fenced DR standby read-only while protecting new tables", () => {
    expect(migrationSource).toContain("backend_code = 'DR'");
    expect(migrationSource).toContain("backend_role = 'READ_ONLY_STANDBY'");
    expect(migrationSource).toContain("perform app_private.assert_backend_writable()");
    expect(migrationSource.match(/create trigger backend_writable_guard/g)).toHaveLength(2);
    expect(migrationSource).not.toContain("session_replication_role");
  });

  it("enforces bounded lifetime, usage, rotation, pause, and checkout states", () => {
    expect(migrationSource).toContain("credential_ttl_seconds between 60 and 900");
    expect(migrationSource).toContain("max_redemptions between 1 and 3");
    expect(migrationSource).toContain(
      "'ACTIVE', 'CONSUMED', 'PAUSED', 'ROTATED', 'CHECKED_OUT', 'EXPIRED', 'REVOKED'",
    );
    const transition = extractFunction("app_private.enforce_dynamic_qr_credential_transition(");
    expect(transition).toContain("DYNAMIC_QR_STATE_TRANSITION_INVALID");
    expect(transition).toContain("DYNAMIC_QR_CREDENTIAL_SCOPE_IMMUTABLE");
    expect(migrationSource).toContain("public.rotate_dynamic_qr_service_point(");
    expect(migrationSource).toContain("public.set_dynamic_qr_service_point_state(");
    expect(migrationSource).toContain("public.invalidate_dynamic_qr_checkout(");
  });

  it("fails closed for replay, shared-device, table, expiry, pause, rotation, and checkout", () => {
    const redeem = extractFunction("public.redeem_dynamic_qr_credential(");
    for (const code of [
      "DYNAMIC_QR_ALREADY_USED",
      "DYNAMIC_QR_DEVICE_MISMATCH",
      "DYNAMIC_QR_SERVICE_POINT_MISMATCH",
      "DYNAMIC_QR_EXPIRED",
      "DYNAMIC_QR_PAUSED",
      "DYNAMIC_QR_ROTATED",
      "DYNAMIC_QR_CHECKED_OUT",
    ]) {
      expect(redeem).toContain(code);
    }
    expect(redeem).toContain("public.consume_public_rate_limit");
    expect(redeem).toContain("public.public_order_preflight(");
    expect(redeem.indexOf("public.public_order_preflight(")).toBeLessThan(
      redeem.indexOf("redemption_count = v_credential.redemption_count + 1"),
    );
  });

  it("returns a no-JS safe static recovery contract without enlarging ordering scope", () => {
    const fallback = extractFunction("app_private.dynamic_qr_static_fallback(");
    expect(fallback).toContain("'STATIC_QR_RECOVERY'");
    expect(fallback).toContain("'static_qr_remains_valid', true");
    expect(fallback).toContain("'SCAN_PRINTED_STATIC_QR'");
    const redeem = extractFunction("public.redeem_dynamic_qr_credential(");
    expect(redeem).toContain("v_session.qr_code_id <> v_credential.static_qr_code_id");
    expect(redeem).toContain("v_session.id <> v_credential.order_session_id");
    expect(redeem).toContain(
      "v_qr.dining_table_id is distinct from v_credential.dining_table_id",
    );
  });

  it("forces RLS, keeps mutations service-role only, and records tenant audit", () => {
    expect(migrationSource.match(/force row level security/g)).toHaveLength(2);
    expect(migrationSource).toContain("insert into public.audit_logs");
    expect(migrationSource).toContain("actor_profile_id");
    expect(migrationSource).not.toContain("actor_user_id");
    expect(migrationSource).not.toMatch(/grant execute[\s\S]*to anon/i);
    expect(migrationSource).not.toMatch(/grant execute[\s\S]*to authenticated/i);
    expect(migrationSource.match(/grant execute on function public\./g)?.length ?? 0)
      .toBeGreaterThanOrEqual(6);
    expect(migrationSource.match(/to service_role;/g)?.length ?? 0)
      .toBeGreaterThanOrEqual(8);
  });
});
