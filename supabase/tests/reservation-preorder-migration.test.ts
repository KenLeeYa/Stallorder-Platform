import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(new URL(
  "../migrations/20260821012140_reservation_preorder_foundation.sql",
  import.meta.url,
));
const adrPath = fileURLToPath(new URL(
  "../../docs/RESERVATION_PREORDER_FOUNDATION_ADR.md",
  import.meta.url,
));
const migrationSource = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").replace(/\r\n/g, "\n")
  : "";
const adrSource = readFileSync(adrPath, "utf8").replace(/\r\n/g, "\n");

function extractFunction(signature: string) {
  const start = [
    migrationSource.indexOf(`create function ${signature}`),
    migrationSource.indexOf(`create or replace function ${signature}`),
  ].filter((index) => index >= 0).sort((left, right) => left - right)[0] ?? -1;
  const end = migrationSource.indexOf("\n$$;", start);
  if (start < 0 || end < 0) throw new Error(`FUNCTION_NOT_FOUND:${signature}`);
  return migrationSource.slice(start, end + 4);
}

function expectBefore(source: string, first: RegExp, second: RegExp) {
  const firstIndex = source.search(first);
  const secondIndex = source.search(second);
  expect(firstIndex).toBeGreaterThanOrEqual(0);
  expect(secondIndex).toBeGreaterThan(firstIndex);
}

describe("reservation-linked preorder migration contract", () => {
  it("ships the reviewed append-only migration and provisional ADR", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(adrSource).toContain("Status: Proposed / provisional");
    expect(adrSource).toContain("Production decision: Not approved");
    expect(adrSource).toContain("default_enabled = false");
    expect(adrSource).toContain("No money is collected in this phase");
  });

  it("keeps reservation capacity separate from existing PREORDER sessions", () => {
    expect(migrationSource).toContain("create table public.reservations");
    expect(migrationSource).toContain("create table public.reservation_preorder_sessions");
    expect(migrationSource).toContain("reservation_preorder_sessions_reservation_scope_fkey");
    expect(migrationSource).not.toMatch(/(?:alter table|insert into) public\.order_sessions/i);
  });

  it("defaults the foundation off and preserves cancellation under the kill switch", () => {
    expect(migrationSource).toMatch(/'RESERVATION_PREORDER_ENABLED'[\s\S]*false,[\s\S]*false/);
    const create = extractFunction("app_private.create_reservation(");
    const modify = extractFunction("app_private.modify_reservation(");
    const cancel = extractFunction("app_private.cancel_reservation(");
    const issue = extractFunction("app_private.issue_reservation_preorder_session(");
    expect(create).toContain("RESERVATION_FEATURE_DISABLED");
    expect(modify).toContain("RESERVATION_FEATURE_DISABLED");
    expect(issue).toContain("RESERVATION_FEATURE_DISABLED");
    expect(cancel).not.toContain("RESERVATION_FEATURE_DISABLED");
  });

  it("enforces tenant scope, RLS, audit, and hash-only token storage", () => {
    expect(migrationSource).toContain("reservations_table_scope_fkey");
    expect(migrationSource).toContain("reservation_preorder_sessions_reservation_scope_fkey");
    expect(migrationSource).toContain("alter table public.reservations force row level security");
    expect(migrationSource).toContain("alter table public.reservation_preorder_sessions force row level security");
    expect(migrationSource).toContain("from public, anon, authenticated");
    expect(migrationSource).toContain("insert into public.audit_logs");
    expect(migrationSource).toContain("public_token_hash");
    expect(migrationSource).not.toMatch(/\bpublic_token\s+text/i);
  });

  it("locks a table and rejects concurrent overlapping confirmed ranges", () => {
    expect(migrationSource).toContain("pg_advisory_xact_lock");
    expect(migrationSource).toMatch(/exclude using gist\s*\([\s\S]*tstzrange\(starts_at, ends_at, '\[\)'\)[\s\S]*with &&/i);
    expect(migrationSource).toContain("where (status = 'CONFIRMED')");
  });

  it("validates timezone and derives cross-midnight business date and cutoffs", () => {
    expect(migrationSource).toContain("from pg_catalog.pg_timezone_names");
    expect(migrationSource).toContain("new.local_business_date := (new.starts_at at time zone new.timezone)::date");
    expect(migrationSource).toContain("new.preorder_opens_at := new.starts_at - interval '24 hours'");
    expect(migrationSource).toContain("new.preorder_cutoff_at := new.starts_at - interval '30 minutes'");
    expect(migrationSource).toContain("new.cancellation_cutoff_at := new.starts_at - interval '2 hours'");
  });

  it("locks and validates the reservation before inserting any preorder session", () => {
    const issue = extractFunction("app_private.issue_reservation_preorder_session(");
    expectBefore(issue, /for update of reservation/, /insert into public\.reservation_preorder_sessions/);
    expectBefore(issue, /reservation\.status = 'CONFIRMED'/, /insert into public\.reservation_preorder_sessions/);
    expectBefore(issue, /reservation\.preorder_opens_at/, /insert into public\.reservation_preorder_sessions/);
    expectBefore(issue, /reservation\.preorder_cutoff_at/, /insert into public\.reservation_preorder_sessions/);
    expectBefore(issue, /table_record\.is_active/, /insert into public\.reservation_preorder_sessions/);
  });
});
