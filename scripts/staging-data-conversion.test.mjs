import { describe, expect, it } from "vitest";
import { stagingAuthPatch, stagingEdgeConfiguration, scopedDatabaseEnvironment } from "./staging-data-conversion.mjs";

describe("synthetic Staging provider isolation", () => {
  it("disables external Auth and hooks without modifying project JWT keys", () => {
    const patch = stagingAuthPatch({ external_google_enabled: true, external_google_secret: "source-secret",
      external_google_client_id: "source-client", hook_send_email_enabled: true,
      hook_send_email_uri: "https://production.example", hook_send_email_secrets: "old-hook",
      jwt_secret: "project-owned", smtp_pass: "old-password", external_email_enabled: true });
    expect(patch).toMatchObject({ external_google_enabled: false, external_google_secret: "",
      external_google_client_id: "", hook_send_email_enabled: false, hook_send_email_uri: "",
      hook_send_email_secrets: "", external_email_enabled: false, disable_signup: true,
      site_url: "https://staging.qidaigo.com", smtp_host: "disabled.staging.invalid" });
    expect(patch).not.toHaveProperty("jwt_secret");
    expect(JSON.stringify(patch)).not.toContain("source-secret");
  });
  it("creates independent test-only Edge settings with no live provider credentials", () => {
    const config = stagingEdgeConfiguration();
    expect(config).toMatchObject({ APP_ENV: "test", TURNSTILE_ALLOW_TEST_KEYS: "true",
      PUBLIC_APP_ORIGINS: "https://staging.qidaigo.com", TURNSTILE_EXPECTED_HOSTNAME: "staging.qidaigo.com" });
    expect(config.ABUSE_HASH_SECRET).toHaveLength(64);
    expect(config.TOKEN_DERIVATION_SECRET).not.toBe(config.ABUSE_HASH_SECRET);
    expect(config).not.toHaveProperty("GOOGLE_CLIENT_SECRET");
  });
  it("strips inherited DB targets and requires TLS for the exact hosted reset", () => {
    expect(scopedDatabaseEnvironment({ PATH: "tools", PGHOST: "primary", DATABASE_URL: "primary",
      PRIMARY_SUPABASE_SECRET_KEY: "private", DR_DIRECT_URL: "private", SUPABASE_ACCESS_TOKEN: "private" }))
      .toEqual({ PATH: "tools", PGSSLMODE: "require" });
  });
});
