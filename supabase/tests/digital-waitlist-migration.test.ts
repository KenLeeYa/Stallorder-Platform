import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationSource = normalizeLineEndings(readFileSync(fileURLToPath(new URL(
  "../migrations/20260821012142_digital_waitlist_foundation.sql",
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

describe("digital waitlist foundation migration", () => {
  it("ships disabled and cannot be enabled by this migration", () => {
    expect(migrationSource).toContain("'DIGITAL_WAITLIST_FOUNDATION_ENABLED'");
    expect(migrationSource).toMatch(
      /'DIGITAL_WAITLIST_FOUNDATION_ENABLED',[\s\S]*?false,[\s\S]*?false/,
    );
    expect(migrationSource).not.toMatch(
      /update public\.resilience_feature_flags[\s\S]*default_enabled\s*=\s*true/i,
    );
  });

  it("creates tenant-scoped rows, forced RLS, and one active entry per duplicate key", () => {
    expect(migrationSource).toContain("create type public.digital_waitlist_status as enum");
    expect(migrationSource).toContain("create table public.digital_waitlist_entries");
    expect(migrationSource).toContain("create table public.digital_waitlist_notifications");
    expect(migrationSource).toContain(
      "foreign key (stall_id, organization_id)\n    references public.stalls(id, organization_id)",
    );
    expect(migrationSource).toContain(
      "create unique index digital_waitlist_entries_one_active_duplicate",
    );
    expect(migrationSource).toContain("where status in ('WAITING', 'NOTIFIED')");
    expect(migrationSource.match(/force row level security/g)).toHaveLength(2);
    expect(migrationSource).toContain(
      "app_private.has_stall_role(stall_id, null::public.user_role[])",
    );
    expect(migrationSource).not.toContain(
      "grant select on table public.digital_waitlist_entries to authenticated",
    );
    expect(migrationSource).toContain(
      "seating_exchange_expires_at, seating_exchange_consumed_at",
    );
  });

  it("enforces the state machine in the database", () => {
    const guard = extractFunction("app_private.enforce_digital_waitlist_transition(");
    expect(guard).toContain("WAITLIST_STATE_TRANSITION_INVALID");
    expect(guard).toContain("WAITLIST_HOLD_ACTIVE");
    expect(guard).toContain("WAITLIST_SEATING_CONTRACT_REQUIRED");
    expect(guard).toContain("old.state_version + 1");
    expect(migrationSource).toContain(
      "before update on public.digital_waitlist_entries",
    );
  });

  it("rate-limits join attempts before inserting an entry", () => {
    const join = extractFunction("public.join_digital_waitlist(");
    expect(join.match(/public\.consume_public_rate_limit/g)).toHaveLength(2);
    expect(join).toContain("'WAITLIST_IP'");
    expect(join).toContain("'WAITLIST_DEVICE'");
    expect(join).toContain("'WAITLIST_RATE_LIMITED'");
    expect(join.indexOf("public.consume_public_rate_limit")).toBeLessThan(
      join.indexOf("insert into public.digital_waitlist_entries"),
    );
  });

  it("records IN_APP mock notifications without an external delivery claim", () => {
    expect(migrationSource).toContain("check (channel = 'IN_APP')");
    expect(migrationSource).toContain("check (delivery_state = 'MOCK_RECORDED')");
    const transition = extractFunction("public.transition_digital_waitlist_entry(");
    expect(transition).toContain("insert into public.digital_waitlist_notifications");
    expect(transition).toContain("'IN_APP'");
    expect(transition).toContain("'MOCK_RECORDED'");
  });

  it("keeps waitlist and ordering credentials separate during seating exchange", () => {
    const exchange = extractFunction("public.exchange_digital_waitlist_seating(");
    expect(exchange).toContain("entry.public_token_hash = p_public_token_hash");
    expect(exchange).toContain(
      "v_entry.seating_exchange_token_hash is distinct from p_seating_token_hash",
    );
    expect(exchange).toContain("qr.dining_table_id = v_entry.assigned_dining_table_id");
    expect(exchange).toContain("insert into public.order_sessions");
    expect(exchange).toContain("p_session_token_hash");
    expect(exchange).toContain("'DEFAULT'");
    expect(exchange).toContain("seating_exchange_consumed_at = v_now");
    const orderSessionInsert = exchange.slice(
      exchange.indexOf("insert into public.order_sessions"),
      exchange.indexOf("update public.digital_waitlist_entries"),
    );
    expect(orderSessionInsert).toContain("p_session_token_hash");
    expect(orderSessionInsert).not.toContain("p_public_token_hash");
  });

  it("fails closed in every public contract and grants execution only to service_role", () => {
    const signatures = [
      "public.join_digital_waitlist(",
      "public.get_digital_waitlist_status(",
      "public.transition_digital_waitlist_entry(",
      "public.exchange_digital_waitlist_seating(",
    ];
    for (const signature of signatures) {
      const source = extractFunction(signature);
      expect(source).toContain("app_private.digital_waitlist_enabled(");
    }
    expect(extractFunction("public.purge_expired_digital_waitlist_entries(")).not.toContain(
      "app_private.digital_waitlist_enabled(",
    );
    expect(migrationSource.match(/to service_role;/g)?.length ?? 0).toBeGreaterThanOrEqual(7);
    expect(migrationSource).not.toMatch(/grant execute[\s\S]*to anon/i);
    expect(migrationSource).not.toMatch(/grant execute[\s\S]*to authenticated/i);
  });

  it("provides metadata-only audit and bounded retention purge contracts", () => {
    expect(migrationSource).toContain("insert into public.audit_logs");
    expect(migrationSource).not.toMatch(/metadata[^\n]*(public_token|seating_token)/i);
    expect(migrationSource).toContain("retention_expires_at");
    const purge = extractFunction("public.purge_expired_digital_waitlist_entries(");
    expect(purge).toContain("retention_expires_at <= p_now");
    expect(purge).toContain("delete from public.digital_waitlist_entries");
  });
});
