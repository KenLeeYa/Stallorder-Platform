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
  it.each([[null, false, false], ["", false, false], [null, true, false], [null, false, true]])("clears provider credentials with %s readback; rejects reactivation=%s and retained secret=%s", async (emptyValue, reactivateHook, retainSecret) => {
    const hooks = ["mfa_verification_attempt", "password_verification_attempt", "custom_access_token",
      "send_sms", "send_email", "before_user_created", "after_user_created"];
    const source = Object.fromEntries(hooks.flatMap((hook) => [
      [`hook_${hook}_enabled`, false], [`hook_${hook}_uri`, null], [`hook_${hook}_secrets`, null],
    ]));
    Object.assign(source, { hook_send_email_enabled: true,
      hook_send_email_uri: "https://fixture.example/hook", hook_send_email_secrets: "fixture-only-secret",
      external_apple_enabled: false, external_apple_secret: null,
      external_google_enabled: true, external_google_client_id: "fixture-client", external_google_secret: "fixture-google-secret",
      sms_twilio_auth_token: null });
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
          // Actual API39726852632 rejects configuring unused paid Hooks at all,
          // including a false/null no-op. No billing change is authorized.
          if (Object.keys(patch).some((name) => /^hook_(mfa_verification_attempt|password_verification_attempt)_/.test(name))) {
            return Response.json({ message: "The following auth hooks cannot be configured for this organization" }, { status: 402 });
          }
          // Hosted API39726312396 rejects empty Hook URI/secret strings even
          // when enabled=false. Nullable fields are the documented clear contract.
          if (hooks.some((hook) => patch[`hook_${hook}_uri`] === "" || patch[`hook_${hook}_secrets`] === "")) {
            return Response.json({ message: "Invalid Auth Hook URI; Auth Hook Secret must follow Standard Webhooks format" }, { status: 400 });
          }
          for (const hook of hooks) {
            if (hook === "send_email") {
              expect(patch[`hook_${hook}_enabled`]).toBe(false);
              expect(patch[`hook_${hook}_uri`]).toBeNull();
              expect(patch[`hook_${hook}_secrets`]).toBeNull();
            } else {
              for (const suffix of ["enabled", "uri", "secrets"]) expect(patch).not.toHaveProperty(`hook_${hook}_${suffix}`);
            }
          }
          auth = { ...source, ...Object.fromEntries(Object.entries(patch).map(([key, value]) => [key,
            // Apply39752454954 accepted empty secret strings but read back a
            // nonempty 64-character value. Only nullable clearing proves empty.
            value === "" && /^(external_|sms_).*(secret|token)$/.test(key) ? "a".repeat(64)
              : value === null ? emptyValue : value])) };
          if (reactivateHook) auth.hook_mfa_verification_attempt_enabled = true;
          if (retainSecret) auth.external_google_secret = "a".repeat(64);
        }
        return Response.json(auth);
      }
      expect(url.pathname.endsWith("/secrets")).toBe(true);
      if (options.method === "POST") edge = JSON.parse(options.body).map(({ name, value }) => ({ name, value: conversionDigest(value) }));
      return Response.json(edge);
    }));
    const operation = isolateStagingProviders({ sourceSha: "test-source", providerPrestate: {
      authDigest: conversionDigest(source), edgeSecretsDigest: conversionDigest([]),
    } });
    if (reactivateHook || retainSecret) await expect(operation).rejects.toThrow("STAGING_AUTH_ISOLATION_FAILED");
    else await operation;
    expect(patchRequests).toBe(1);
    if (reactivateHook || retainSecret) expect(edge).toEqual([]);
    else expect(edge.length).toBeGreaterThan(0);
  });

  it("disables external Auth and hooks without modifying project JWT keys", () => {
    const patch = stagingAuthPatch({ external_google_enabled: true, external_google_secret: "source-secret",
      external_google_client_id: "source-client", hook_send_email_enabled: true,
      hook_send_email_uri: "https://production.example", hook_send_email_secrets: "old-hook",
      jwt_secret: "project-owned", smtp_pass: "old-password", external_email_enabled: true });
    expect(patch).toMatchObject({ external_google_enabled: false, external_google_secret: null,
      external_google_client_id: null, hook_send_email_enabled: false, hook_send_email_uri: null,
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
  it.each([
    ["nonzero exit", { status: 1 }],
    ["missing executable", { status: null, error: { code: "ENOENT" } }],
    ["timeout", { status: null, error: { code: "ETIMEDOUT" } }],
    ["signal termination", { status: null, signal: "SIGTERM" }],
    ["spawn error despite zero status", { status: 0, error: { code: "EIO" } }],
  ])("preserves an exact sanitized failure code for %s before any seed or follow-up command", async (_name, failure) => {
    vi.stubEnv("DR_DIRECT_URL", "postgresql://postgres.daeqwtpaxcebmtwxqdkj@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require");
    const network = vi.fn(() => { throw new Error("unexpected follow-up request"); });
    vi.stubGlobal("fetch", network);
    vi.mocked(spawnSync).mockReturnValue({
      stdout: "Resetting remote database; fixture-password",
      stderr: "postgresql://private.invalid/secret; SQL: private statement",
      ...failure,
    });

    // Apply accepts only an exact STAGING_* message. A substring assertion misses
    // Node AssertionError's appended actual/expected values and the lost code.
    await expect(resetAndSeedStaging()).rejects.toMatchObject({ message: "STAGING_SUPABASE_COMMAND_FAILED" });
    expect(spawnSync).toHaveBeenCalledTimes(1);
    expect(network).not.toHaveBeenCalled();
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
