import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(new URL(
  "../migrations/20260821012143_online_order_payment_reconciliation.sql",
  import.meta.url,
));
const adrPath = fileURLToPath(new URL(
  "../../docs/ONLINE_ORDER_PAYMENT_RECONCILIATION_ADR.md",
  import.meta.url,
));
const migrationSource = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").replace(/\r\n/g, "\n")
  : "";
const adrSource = existsSync(adrPath)
  ? readFileSync(adrPath, "utf8").replace(/\r\n/g, "\n")
  : "";

function extractFunction(signature: string) {
  const start = [
    migrationSource.indexOf(`create function ${signature}`),
    migrationSource.indexOf(`create or replace function ${signature}`),
  ].filter((index) => index >= 0).sort((left, right) => left - right)[0] ?? -1;
  const end = migrationSource.indexOf("\n$$;", start);
  if (start < 0 || end < 0) throw new Error(`FUNCTION_NOT_FOUND:${signature}`);
  return migrationSource.slice(start, end + 4);
}

describe("online order payment reconciliation migration contract", () => {
  it("ships a provisional, provider-neutral decision with no Production claim", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(adrSource).toContain("Status: Proposed / provisional");
    expect(adrSource).toContain("Production decision: Not approved");
    expect(adrSource).toContain("No production provider has been selected");
    expect(adrSource).toContain("LOCAL_MOCK");
    expect(adrSource).toContain("https://docs.stripe.com/webhooks");
    expect(adrSource).toContain("https://docs.stripe.com/api/idempotent_requests");
    expect(adrSource).toContain("Third_Party_Payment_Gateway_Integration_Cheat_Sheet");
  });

  it("ships disabled and cannot enable itself", () => {
    expect(migrationSource).toMatch(
      /'ONLINE_ORDER_PAYMENT_ENABLED',[\s\S]*?false,[\s\S]*?false/,
    );
    expect(migrationSource).not.toMatch(
      /update public\.resilience_feature_flags[\s\S]*default_enabled\s*=\s*true/i,
    );
  });

  it("stores tenant-scoped intents and normalized events with forced RLS", () => {
    expect(migrationSource).toContain("create table public.online_order_payment_intents");
    expect(migrationSource).toContain("create table public.online_order_payment_events");
    expect(migrationSource).toContain("online_order_payment_intents_order_scope_fkey");
    expect(migrationSource).toContain(
      "online_order_payment_intents_reconciled_payment_scope_fkey",
    );
    expect(migrationSource).toContain("online_order_payment_events_intent_scope_fkey");
    expect(migrationSource.match(/force row level security/g)).toHaveLength(2);
    expect(migrationSource).toContain("check (provider = 'LOCAL_MOCK')");
    expect(migrationSource).toContain("unique (provider, provider_event_id)");
    expect(migrationSource).toContain("unique (organization_id, stall_id, idempotency_key)");
    expect(migrationSource).toContain("unique (order_id)");
  });

  it("keeps a fenced DR standby read-only while protecting new tables", () => {
    expect(migrationSource).toContain("backend_code = 'DR'");
    expect(migrationSource).toContain("backend_role = 'READ_ONLY_STANDBY'");
    expect(migrationSource).toContain("perform app_private.assert_backend_writable()");
    expect(migrationSource.match(/create trigger backend_writable_guard/g)).toHaveLength(2);
    expect(migrationSource).not.toContain("session_replication_role");
  });

  it("keeps secrets, raw bodies, and PII out of persisted ledgers", () => {
    expect(migrationSource).toContain("body_sha256 text not null");
    expect(migrationSource).toContain("signature_timestamp timestamptz not null");
    expect(migrationSource).not.toMatch(/\braw_body\b/i);
    expect(migrationSource).not.toMatch(/\bsignature\s+text\b/i);
    expect(migrationSource).not.toMatch(/customer_(?:name|phone|email)/i);
    expect(migrationSource).toContain("extensions.digest(");
    expect(migrationSource).toContain("'online-payment:' || encode(");
  });

  it("limits mutations and RPC execution to service_role", () => {
    expect(migrationSource).toContain("from public, anon, authenticated");
    expect(migrationSource).toMatch(
      /grant select, insert, update, delete[\s\S]*online_order_payment_intents[\s\S]*online_order_payment_events[\s\S]*to service_role;/,
    );
    expect(migrationSource).not.toMatch(/grant (?:insert|update|delete)[\s\S]*to authenticated/i);
    expect(migrationSource).not.toMatch(/grant execute[\s\S]*to (?:anon|authenticated)/i);
  });

  it("makes intent creation server-trusted and idempotent", () => {
    const create = extractFunction("app_private.create_online_order_payment_intent(");
    expect(create).toContain("app_private.evaluate_resilience_feature_flag(");
    expect(create).toContain("ONLINE_ORDER_PAYMENT_DISABLED");
    expect(create).toContain("from public.orders");
    expect(create).toContain("join public.stalls");
    expect(create).toContain("v_order.total");
    expect(create).toContain("stall.currency");
    expect(create).toContain("PAYMENT_IDEMPOTENCY_CONFLICT");
    expect(create).toContain("PAYMENT_ORDER_INTENT_EXISTS");
  });

  it("records signed webhook results without touching orders or payments", () => {
    const record = extractFunction("app_private.record_online_order_payment_event(");
    expect(record).toContain("PAYMENT_WEBHOOK_TIMESTAMP_EXPIRED");
    expect(record).toContain("PAYMENT_EVENT_IDEMPOTENCY_CONFLICT");
    expect(record).toContain("insert into public.online_order_payment_events");
    expect(record).toContain("IGNORED_OUT_OF_ORDER");
    expect(record).not.toMatch(/insert into public\.payments/i);
    expect(record).not.toMatch(/update public\.orders/i);
  });

  it("creates an existing payment only inside a matched reconciliation transaction", () => {
    const reconcile = extractFunction("app_private.reconcile_online_order_payment(");
    expect(reconcile.match(/for update;/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(reconcile).toContain("PAYMENT_RECONCILIATION_MISMATCH");
    expect(reconcile).toContain("insert into public.payments");
    expect(reconcile).toContain("'OTHER'::public.payment_method");
    expect(reconcile).toContain("update public.orders");
    expect(reconcile).toContain("'PAID'::public.payment_status");
    expect(reconcile).toContain("idempotentReplay");
  });
});
