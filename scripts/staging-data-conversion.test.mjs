import { afterEach, describe, expect, it, vi } from "vitest";
import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { stagingAuthPatch, stagingEdgeConfiguration, scopedDatabaseEnvironment, resetAndSeedStaging, isolateStagingProviders } from "./staging-data-conversion.mjs";
import { conversionDigest, STAGING_TARGET } from "./dr-staging-conversion-plan.mjs";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...await importOriginal(), mkdir: vi.fn(), writeFile: vi.fn(),
}));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe("synthetic Staging provider isolation", () => {
  it.each([null, ""])("clears disabled Auth Hooks using nullable API fields and verifies %s readback", async (emptyValue) => {
    const hooks = ["mfa_verification_attempt", "password_verification_attempt", "custom_access_token",
      "send_sms", "send_email", "before_user_created", "after_user_created"];
    const source = Object.fromEntries(hooks.flatMap((hook) => [
      [`hook_${hook}_enabled`, false], [`hook_${hook}_uri`, null], [`hook_${hook}_secrets`, null],
    ]));
    let auth = source;
    let edge = [];
    let patchRequests = 0;
    vi.stubEnv("SUPABASE_ACCESS_TOKEN", "unit-test-only");
    vi.stubEnv("DR_BACKUP_ENCRYPTION_KEY", "unit-test-backup-only");
    vi.stubGlobal("fetch", vi.fn(async (input, options) => {
      const url = new URL(input);
      expect(url.origin).toBe("https://api.supabase.com");
      expect(url.pathname.startsWith(`/v1/projects/${STAGING_TARGET.ref}/`)).toBe(true);
      if (url.pathname.endsWith("/config/auth")) {
        if (options.method === "PATCH") {
          patchRequests += 1;
          const patch = JSON.parse(options.body);
          // Hosted API39726312396 rejects empty Hook URI/secret strings even
          // when enabled=false. Nullable fields are the documented clear contract.
          if (hooks.some((hook) => patch[`hook_${hook}_uri`] === "" || patch[`hook_${hook}_secrets`] === "")) {
            return Response.json({ message: "Invalid Auth Hook URI; Auth Hook Secret must follow Standard Webhooks format" }, { status: 400 });
          }
          for (const hook of hooks) {
            expect(patch[`hook_${hook}_enabled`]).toBe(false);
            expect(patch[`hook_${hook}_uri`]).toBeNull();
            expect(patch[`hook_${hook}_secrets`]).toBeNull();
          }
          auth = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, value === null ? emptyValue : value]));
        }
        return Response.json(auth);
      }
      expect(url.pathname.endsWith("/secrets")).toBe(true);
      if (options.method === "POST") edge = JSON.parse(options.body).map(({ name, value }) => ({ name, value: conversionDigest(value) }));
      return Response.json(edge);
    }));
    await isolateStagingProviders({ sourceSha: "test-source", providerPrestate: {
      authDigest: conversionDigest(source), edgeSecretsDigest: conversionDigest([]),
    } });
    expect(patchRequests).toBe(1);
    expect(edge.length).toBeGreaterThan(0);
  });

  it("disables external Auth and hooks without modifying project JWT keys", () => {
    const patch = stagingAuthPatch({ external_google_enabled: true, external_google_secret: "source-secret",
      external_google_client_id: "source-client", hook_send_email_enabled: true,
      hook_send_email_uri: "https://production.example", hook_send_email_secrets: "old-hook",
      jwt_secret: "project-owned", smtp_pass: "old-password", external_email_enabled: true });
    expect(patch).toMatchObject({ external_google_enabled: false, external_google_secret: "",
      external_google_client_id: "", hook_send_email_enabled: false, hook_send_email_uri: null,
      hook_send_email_secrets: null, external_email_enabled: false, disable_signup: true,
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
  it("runs every hosted SQL test in bounded batches without extending command deadlines", async () => {
    vi.stubEnv("DR_DIRECT_URL", "postgresql://postgres.daeqwtpaxcebmtwxqdkj@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require");
    vi.stubEnv("SUPABASE_ACCESS_TOKEN", "unit-test-only");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    const batches = [];
    vi.mocked(spawnSync).mockImplementation((_command, args, options) => {
      expect(options.timeout).toBe(600_000);
      if (args[0] === "test") {
        const files = args.slice(2, args.indexOf("--db-url"));
        // The observed full hosted suite takes over twelve minutes; a ten-minute
        // subprocess must not attempt the entire suite in one invocation.
        if (!files.length || files.length > 20) return { status: null, error: { code: "ETIMEDOUT" } };
        batches.push(files);
      }
      return { status: 0, stdout: "Resetting remote database", stderr: "" };
    });
    await resetAndSeedStaging();
    const files = (await readdir("supabase/tests", { recursive: true }))
      .filter((name) => name.endsWith(".sql")).map((name) => `supabase/tests/${name.replaceAll("\\", "/")}`).sort();
    expect(files.length).toBeGreaterThan(20);
    expect(batches.flat()).toEqual(files);
  });
  it("fails closed when any hosted database test batch fails", async () => {
    vi.stubEnv("DR_DIRECT_URL", "postgresql://postgres.daeqwtpaxcebmtwxqdkj@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require");
    vi.stubEnv("SUPABASE_ACCESS_TOKEN", "unit-test-only");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    vi.mocked(spawnSync).mockImplementation((_command, args) => ({
      status: args[0] === "test" ? 1 : 0, stdout: "Resetting remote database", stderr: "",
    }));
    await expect(resetAndSeedStaging()).rejects.toThrow("STAGING_SUPABASE_COMMAND_FAILED");
    expect(vi.mocked(spawnSync).mock.calls.some(([, args]) => args[1] === "lint")).toBe(false);
  });
});
