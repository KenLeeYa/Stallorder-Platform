import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationSource = normalizeLineEndings(readFileSync(fileURLToPath(new URL(
  "../migrations/20260821012139_target_stall_schedule_catch_up.sql",
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

function expectBefore(source: string, first: RegExp, second: RegExp) {
  const firstIndex = source.search(first);
  const secondIndex = source.search(second);
  expect(firstIndex).toBeGreaterThanOrEqual(0);
  expect(secondIndex).toBeGreaterThan(firstIndex);
}

describe("targeted stall schedule catch-up migration", () => {
  it("scopes every schedule and delayed-alert mutation to the requested stall", () => {
    const targeted = extractFunction("app_private.process_stall_schedules_for_stall(");

    expect(targeted).toContain("schedule.stall_id = p_stall_id");
    expect(targeted.match(/schedule\.stall_id = p_stall_id/g)).toHaveLength(6);
    expect(targeted).toContain("alert.stall_id = p_stall_id");
    expect(targeted).not.toContain("app_private.process_stall_schedules(");
  });

  it("leaves the published global scheduler and RPC signatures untouched", () => {
    expect(migrationSource).not.toMatch(/alter function/i);
    expect(migrationSource).not.toMatch(
      /create(?: or replace)? function app_private\.process_stall_schedules\(/i,
    );
    expect(migrationSource).not.toMatch(
      /create(?: or replace)? function public\.issue_idempotent_order_session_with_schedule\(/i,
    );
    expect(migrationSource).not.toMatch(
      /create(?: or replace)? function public\.create_public_order_with_fulfillment_time\(/i,
    );
  });

  it("locks the stall before schedules and before every targeted RPC chain", () => {
    const targeted = extractFunction("app_private.process_stall_schedules_for_stall(");
    expectBefore(
      targeted,
      /from public\.stalls stall[\s\S]*for update/,
      /from public\.stall_schedules schedule[\s\S]*for update skip locked/,
    );

    for (const signature of [
      "public.issue_idempotent_order_session_with_schedule_targeted(",
      "public.create_public_order_with_fulfillment_time_targeted(",
    ]) {
      const source = extractFunction(signature);
      expectBefore(
        source,
        /for update of stall/,
        /app_private\.[a-z_]+_targeted\(/,
      );
    }
  });

  it("keeps the complete session and order chain on targeted-only variants", () => {
    const signatures = [
      "app_private.issue_order_session_with_schedule_targeted(",
      "public.issue_idempotent_order_session_with_schedule_targeted(",
      "app_private.create_public_order_with_schedule_targeted(",
      "app_private.create_public_delivery_order_with_schedule_targeted(",
      "app_private.create_public_preorder_with_schedule_targeted(",
      "app_private.create_public_order_with_experience_targeted(",
      "public.create_public_order_with_fulfillment_time_targeted(",
    ];
    for (const signature of signatures) {
      const source = extractFunction(signature);
      expect(source).not.toContain("app_private.process_stall_schedules(now())");
      expect(source).not.toContain("_global_legacy(");
    }
    expect(extractFunction("public.issue_idempotent_order_session_with_schedule_targeted(")).toContain(
      "app_private.issue_order_session_with_schedule_targeted(",
    );
    expect(extractFunction("app_private.create_public_order_with_experience_targeted(")).toContain(
      "app_private.create_public_preorder_with_schedule_targeted(",
    );
    expect(extractFunction("app_private.create_public_order_with_experience_targeted(")).toContain(
      "app_private.create_public_order_with_schedule_targeted(",
    );
    expect(extractFunction("public.create_public_order_with_fulfillment_time_targeted(")).toContain(
      "app_private.create_public_delivery_order_with_schedule_targeted(",
    );
    expect(extractFunction("public.create_public_order_with_fulfillment_time_targeted(")).toContain(
      "app_private.create_public_order_with_experience_targeted(",
    );
  });

  it("exposes only the targeted processor and two public entry points to service role", () => {
    expect(migrationSource).toContain([
      "revoke all on function app_private.process_stall_schedules_for_stall(uuid, timestamptz)",
      "from public, anon, authenticated;",
    ].join("\n"));
    expect(migrationSource).toContain([
      "grant execute on function app_private.process_stall_schedules_for_stall(uuid, timestamptz)",
      "to service_role;",
    ].join("\n"));
    expect(migrationSource).toContain(
      "grant execute on function public.issue_idempotent_order_session_with_schedule_targeted(",
    );
    expect(migrationSource).toContain(
      "grant execute on function public.create_public_order_with_fulfillment_time_targeted(",
    );
    expect(migrationSource).not.toMatch(
      /grant execute on function app_private\.(?:issue_order_session|create_public_).*_targeted/i,
    );
  });
});
