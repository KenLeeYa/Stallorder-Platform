import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationSource = readFileSync(fileURLToPath(new URL(
  "../migrations/20260813060000_crm_loyalty_consent_foundation.sql",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");

function extractFunction(signature: string) {
  const start = [
    `create function ${signature}`,
    `create or replace function ${signature}`,
  ].map((declaration) => migrationSource.indexOf(declaration))
    .find((index) => index >= 0) ?? -1;
  const end = migrationSource.indexOf("\n$$;", start);
  if (start < 0 || end < 0) throw new Error(`FUNCTION_NOT_FOUND:${signature}`);
  return migrationSource.slice(start, end + 4);
}

describe("CRM and loyalty consent foundation migration", () => {
  it("ships disabled and separates consent from order fulfillment", () => {
    expect(migrationSource).toMatch(
      /'CRM_LOYALTY_CONSENT_FOUNDATION_ENABLED',[\s\S]*?false,[\s\S]*?false/,
    );
    expect(migrationSource).not.toMatch(
      /update public\.resilience_feature_flags[\s\S]*default_enabled\s*=\s*true/i,
    );
    expect(migrationSource).not.toMatch(/alter table public\.orders/i);
    expect(migrationSource).not.toMatch(/update public\.orders/i);
    expect(extractFunction("public.opt_in_crm_loyalty_profile(")).not.toContain(
      "from public.orders",
    );
  });

  it("records granular, versioned, auditable consent and withdrawal", () => {
    expect(migrationSource).toContain("create table public.crm_consent_records");
    expect(migrationSource).toContain("purpose_code");
    expect(migrationSource).toContain("notice_version");
    expect(migrationSource).toContain("consent_source");
    expect(migrationSource).toContain("lawful_basis");
    expect(migrationSource).toContain("withdrawn_at");
    expect(migrationSource).toContain("retention_expires_at");
    expect(migrationSource).toContain("create table public.crm_erasure_tombstones");
  });

  it("creates profiles only through explicit opt-in using a verified contact reference", () => {
    const optIn = extractFunction("public.opt_in_crm_loyalty_profile(");
    expect(optIn).toContain("p_contact_verified_at");
    expect(optIn).toContain("CRM_CONTACT_NOT_VERIFIED");
    expect(optIn).toContain("CRM_EXPLICIT_OPT_IN_REQUIRED");
    expect(optIn).toContain("insert into public.crm_profiles");
    expect(optIn).not.toContain("from public.orders");
    expect(migrationSource).toContain("contact_identifier_hash");
    expect(migrationSource).not.toContain("customer_phone");
    expect(migrationSource).not.toContain("customer_email");
  });

  it("uses an immutable idempotent points ledger independent of current order totals", () => {
    expect(migrationSource).toContain("create table public.loyalty_points_ledger");
    expect(migrationSource).toContain("'EARN', 'ADJUST', 'EXPIRE', 'REVERSE'");
    expect(migrationSource).toContain("create unique index loyalty_points_ledger_event_idempotency");
    expect(migrationSource).toContain("create trigger loyalty_points_ledger_immutable_guard");
    const post = extractFunction("public.post_loyalty_points_event(");
    expect(post).toContain("p_points_delta");
    expect(post).toContain("p_order_id");
    expect(post).not.toContain("order.total");
    expect(post).toContain("reversal_of_ledger_id");
  });

  it("forces RLS, exposes minimum columns, and reserves mutations for service_role", () => {
    expect(migrationSource.match(/force row level security/g)).toHaveLength(5);
    expect(migrationSource).toContain("app_private.has_stall_role(");
    expect(migrationSource).toContain("'MERCHANT_OWNER', 'MERCHANT_MANAGER'");
    expect(migrationSource).not.toMatch(/grant select on table public\.crm_profiles to authenticated/i);
    expect(migrationSource).not.toMatch(/grant execute[\s\S]*to anon/i);
    expect(migrationSource).not.toMatch(/grant execute[\s\S]*to authenticated/i);
    expect(migrationSource.match(/to service_role;/g)?.length ?? 0).toBeGreaterThanOrEqual(8);
  });

  it("provides withdraw, unsubscribe, export, and erasure contracts", () => {
    for (const signature of [
      "public.withdraw_crm_consent(",
      "public.unsubscribe_crm_profile(",
      "public.export_crm_loyalty_profile(",
      "public.erase_crm_loyalty_profile(",
    ]) {
      expect(extractFunction(signature)).toContain(
        "app_private.crm_loyalty_foundation_enabled(",
      );
    }
    expect(extractFunction("public.erase_crm_loyalty_profile(")).toContain(
      "insert into public.crm_erasure_tombstones",
    );
  });
});
