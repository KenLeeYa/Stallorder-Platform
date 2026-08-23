import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(new URL(
  "../migrations/20260823180000_auth_payment_provider_foundation.sql",
  import.meta.url,
));
const source = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").replace(/\r\n/g, "\n")
  : "";

describe("auth and payment provider foundation migration", () => {
  it("ships every new provider and auth flag OFF", () => {
    expect(existsSync(migrationPath)).toBe(true);
    for (const code of [
      "OAUTH_MICROSOFT_ENABLED",
      "AUTH_PASSKEYS_ENABLED",
      "PAYMENTS_FOUNDATION_ENABLED",
      "PAYMENTS_MOCK_PROVIDER_ENABLED",
      "PAYMENTS_LINE_PAY_ENABLED",
      "PAYMENTS_JKO_PAY_ENABLED",
      "PAYMENTS_TWQR_ENABLED",
      "PAYMENTS_TAIWAN_PAY_ENABLED",
      "PAYMENTS_PX_PAY_PLUS_ENABLED",
      "PAYMENTS_IPASS_MONEY_ENABLED",
      "PAYMENTS_ICASH_PAY_ENABLED",
      "PAYMENTS_PLUS_PAY_ENABLED",
      "PAYMENTS_EASY_WALLET_ENABLED",
      "PAYMENTS_GAMA_PAY_ENABLED",
      "PAYMENTS_OPAY_ENABLED",
      "PAYMENTS_GATEWAY_ENABLED",
      "PAYMENTS_REFUNDS_ENABLED",
      "PAYMENTS_RECONCILIATION_ENABLED",
    ]) {
      expect(source).toMatch(new RegExp(`'${code}',[\\s\\S]*?false, false`));
    }
    expect(source).not.toMatch(/default_enabled\s*=\s*true/i);
  });

  it("uses additive tables for Passkeys and the provider-neutral ledger", () => {
    for (const table of [
      "passkey_credentials",
      "passkey_challenges",
      "payment_provider_connections",
      "payment_provider_transactions",
      "payment_provider_webhook_events",
      "payment_provider_refunds",
      "payment_reconciliation_cases",
    ]) {
      expect(source).toContain(`create table public.${table}`);
    }
    expect(source).not.toMatch(/drop table|drop column|alter type/i);
  });

  it("stores secret references and webhook hashes, never raw secrets or bodies", () => {
    expect(source).toContain("secret_reference text");
    expect(source).toContain("body_hash text not null");
    expect(source).not.toMatch(/\braw_body\b/i);
    expect(source).not.toMatch(/\bclient_secret\b/i);
    expect(source).not.toMatch(/\bchannel_secret\b/i);
    expect(source).not.toMatch(/\bpan\b|\bcvv\b/i);
  });

  it("enforces TWD integers, provider states, replay keys, and tenant scope", () => {
    expect(source).toContain("payment_provider_transactions_amount_check");
    expect(source).toContain("payment_provider_transactions_currency_check");
    expect(source).toContain("payment_provider_transactions_status_check");
    expect(source).toContain("payment_provider_transactions_idempotency_key");
    expect(source).toContain("payment_provider_webhook_events_provider_event_key");
    expect(source).toContain("payment_provider_transactions_order_scope_fkey");
    expect(source).toContain("validate_payment_provider_scope");
  });

  it("forces RLS, restricts browser roles, and keeps DR write guards", () => {
    expect(source.match(/force row level security/g)).toHaveLength(7);
    expect(source).toContain("from public, anon, authenticated");
    expect(source).not.toMatch(/grant (?:insert|update|delete)[\s\S]*to authenticated/i);
    expect(source.match(/create trigger backend_writable_guard/g)).toHaveLength(7);
    expect(source).toContain("backend_role = 'READ_ONLY_STANDBY'");
    expect(source).not.toContain("session_replication_role");
  });

  it("binds Passkey challenges to one profile, purpose, RP ID, Origin, and five minutes", () => {
    expect(source).toContain("challenge_hash text not null unique");
    expect(source).toContain("expires_at <= created_at + interval '5 minutes'");
    expect(source).toContain("guard_passkey_challenge_update");
    expect(source).toContain("old.consumed_at is not null");
  });
});
