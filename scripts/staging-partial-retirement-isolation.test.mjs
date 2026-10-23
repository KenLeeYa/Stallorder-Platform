import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { currentPartialIsolationQuery, readCurrentPartialIsolation } from "./staging-partial-retirement-isolation.mjs";

const api = vi.hoisted(() => vi.fn());
const query = vi.hoisted(() => vi.fn());
vi.mock("./dr-staging-conversion-plan.mjs", async importOriginal => ({
  ...await importOriginal(), conversionApi: api, conversionQuery: query,
}));
const prefix = "/v1/projects/daeqwtpaxcebmtwxqdkj";
const hash = value => createHash("sha256").update(value).digest("hex");
function fixture() {
  return {
    database: { subscriptions: 0, currentBackends: 1, fenced: true, activeCrons: 0, outgoingRequests: 0,
      authUsers: 0, storageObjects: 0, vaultSecrets: 0, privateSchemas: 0, otherActiveClients: 0 },
    auth: { disable_signup: true, site_url: "https://staging.qidaigo.com", uri_allow_list: "https://staging.qidaigo.com/auth/callback",
      smtp_host: "disabled.staging.invalid", smtp_port: "465", smtp_user: "disabled", smtp_admin_email: "disabled@example.invalid",
      smtp_sender_name: "Staging email disabled", smtp_pass: "private opaque readback",
      external_email_enabled: false, external_google_enabled: false, external_google_client_id: null,
      external_google_secret: null, hook_send_email_enabled: false, hook_send_email_uri: null, hook_send_email_secrets: null },
    edge: Object.entries({ ABUSE_HASH_SECRET: "a".repeat(64), TOKEN_DERIVATION_SECRET: "b".repeat(64),
      TURNSTILE_SECRET_KEY: hash("1x0000000000000000000000000000000AA"), APP_ENV: hash("test"),
      TURNSTILE_ALLOW_TEST_KEYS: hash("true"), TURNSTILE_EXPECTED_HOSTNAME: hash("staging.qidaigo.com"),
      PUBLIC_APP_ORIGINS: hash("https://staging.qidaigo.com"), TRUSTED_CLIENT_IP_HEADER: hash("cf-connecting-ip"),
      SUPABASE_URL: "c".repeat(64) }).map(([name, value]) => ({ name, value })),
  };
}
function serve(value) {
  query.mockResolvedValue([value.database]);
  api.mockImplementation(async (provider, path) => {
    expect(provider).toBe("supabase");
    if (path === `${prefix}/config/auth`) return value.auth;
    if (path === `${prefix}/secrets`) return value.edge;
    throw new Error("unexpected target");
  });
}
describe("current partial-retirement isolation observation", () => {
  beforeEach(() => { api.mockReset(); query.mockReset(); });
  it("checks current DB/Auth/Edge readbacks without treating private metadata as fresh credentials or continuation authority", async () => {
    const value = fixture(); serve(value);
    const { privateIsolation, ...summary } = await readCurrentPartialIsolation();
    expect(privateIsolation).toEqual(value);
    expect(summary).toEqual({ diagnosticOnly: true, planQualified: false,
      currentDatabaseIsolationObserved: true, currentAuthIsolationObserved: true, knownEdgeSettingsMatched: true,
      customEdgeSecretCount: 8, otherActiveClients: 0, independentEdgeCredentialsProven: false,
      sequenceWriterQuiescenceProven: false });
    expect(JSON.stringify(summary)).not.toMatch(/private opaque|smtp|a{64}|b{64}/);
    expect(query).toHaveBeenCalledExactlyOnceWith(currentPartialIsolationQuery(), true);
    expect(api.mock.calls).toEqual([["supabase", `${prefix}/config/auth`], ["supabase", `${prefix}/secrets`]]);
  });

  it("rejects resumed replication, old credentials/data, queued work or a changed backend fence", async () => {
    for (const field of ["subscriptions", "activeCrons", "outgoingRequests", "authUsers", "storageObjects", "vaultSecrets", "privateSchemas"]) {
      const value = fixture(); value.database[field] = 1; serve(value);
      await expect(readCurrentPartialIsolation()).rejects.toThrow(/^STAGING_PARTIAL_ISOLATION_INVALID$/);
    }
    for (const patch of [{ currentBackends: 2 }, { currentBackends: 0 }, { fenced: false },
      { otherActiveClients: -1 }, { otherActiveClients: "0" }, { extra: "private db value" }]) {
      const value = fixture(); Object.assign(value.database, patch); serve(value);
      await expect(readCurrentPartialIsolation()).rejects.toThrow(/^STAGING_PARTIAL_ISOLATION_INVALID$/);
    }
    for (const rows of [[], [{}, {}], [null]]) {
      serve(fixture()); query.mockResolvedValue(rows);
      await expect(readCurrentPartialIsolation()).rejects.toThrow(/^STAGING_PARTIAL_ISOLATION_INVALID$/);
    }
  });

  it("rejects Auth reactivation and residual provider credentials without exposing their values", async () => {
    for (const patch of [{ disable_signup: false }, { site_url: "https://app.qidaigo.com" },
      { smtp_host: "actual-mail.invalid" }, { external_email_enabled: true }, { external_new_enabled: true },
      { hook_new_enabled: true }, { hook_new_uri: "private endpoint" }, { sms_provider_token: "private token" },
      { external_google_secret: "private secret" }, { external_google_enabled: "false" }]) {
      const value = fixture(); Object.assign(value.auth, patch); serve(value);
      await expect(readCurrentPartialIsolation()).rejects.toThrow(/^STAGING_PARTIAL_ISOLATION_INVALID$/);
    }
    const value = fixture(); value.auth.hook_send_email_enabled = null; value.auth.hook_send_email_uri = ""; serve(value);
    expect((await readCurrentPartialIsolation()).currentAuthIsolationObserved).toBe(true);
  });

  it("rejects Edge scope/value/metadata drift and never reveals or rotates any credential", async () => {
    for (const mutate of [
      v => { v.edge.pop(); v.edge.push({ name: "REAL_PAYMENT_KEY", value: hash("private key") }); },
      v => { v.edge.splice(0, 1); }, v => { v.edge.push(v.edge[0]); },
      v => { v.edge.find(e => e.name === "APP_ENV").value = hash("production"); },
      v => { v.edge[0].value = "private plaintext"; },
    ]) {
      const value = fixture(); mutate(value); serve(value);
      await expect(readCurrentPartialIsolation()).rejects.toThrow(/^STAGING_PARTIAL_ISOLATION_INVALID$/);
    }
    expect(api.mock.calls.every(([provider, path, options]) => provider === "supabase"
      && [`${prefix}/config/auth`, `${prefix}/secrets`].includes(path) && options === undefined)).toBe(true);
  });

  it("reports both busy and idle observations without claiming writer quiescence; sanitizes provider failures", async () => {
    const value = fixture(); value.database.otherActiveClients = 2; serve(value);
    expect(await readCurrentPartialIsolation()).toMatchObject({ otherActiveClients: 2,
      sequenceWriterQuiescenceProven: false, independentEdgeCredentialsProven: false, planQualified: false });
    api.mockRejectedValue(new Error("private provider credential"));
    await expect(readCurrentPartialIsolation()).rejects.toThrow(/^STAGING_PARTIAL_ISOLATION_READ_FAILED$/);
    serve(fixture()); query.mockRejectedValue(new Error("private SQL content"));
    await expect(readCurrentPartialIsolation()).rejects.toThrow(/^STAGING_PARTIAL_ISOLATION_READ_FAILED$/);
    const sql = currentPartialIsolationQuery();
    expect(sql.match(/;/g)).toHaveLength(1);
    expect(sql).not.toMatch(/\b(?:insert|update|delete|alter|drop|set_config|pg_notify|query_text)\b/i);
    expect(sql).not.toMatch(/(?<!pg_catalog\.)\b(?:count|current_database|pg_backend_pid)\(/);
    expect(sql).toContain("pg_catalog.pg_stat_activity");
  });
});
