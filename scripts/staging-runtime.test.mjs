import { describe, expect, it } from "vitest";
import { stagingRuntimeConfiguration, assertStagingDeployment } from "./staging-runtime.mjs";

describe("independent Staging runtime", () => {
  it("uses only the retired project's credentials, fixed protected origin and mock integrations", () => {
    const input = {
      directUrl: "postgresql://postgres.daeqwtpaxcebmtwxqdkj:example-placeholder@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require",
      keys: { secret: "test-project-secret", publishable: "test-publishable" },
      edge: { ABUSE_HASH_SECRET: "a".repeat(64), TOKEN_DERIVATION_SECRET: "b".repeat(64), APP_ENV: "test", TURNSTILE_ALLOW_TEST_KEYS: "true" },
      access: { audience: "c".repeat(64), teamDomain: "https://fixture.cloudflareaccess.com" }, sourceSha: "d".repeat(40),
    };
    const env = stagingRuntimeConfiguration(input);
    expect(env.APP_BASE_URL).toBe("https://staging.qidaigo.com");
    expect(env.OAUTH_PROVIDER_MODE).toBe("mock");
    expect(env.PAYMENT_PROVIDER_MODE).toBe("mock");
    expect(env.DR_ACCESS_ENFORCEMENT_ENABLED).toBe("true");
    expect(env.SUPABASE_SECRET_KEY).toBe(input.keys.secret);
    expect(env.DATABASE_URL).toContain(":6543/postgres?");
    expect(env.DATABASE_URL).toContain("pgbouncer=true");
    expect(env.GITHUB_SHA).toBe(input.sourceSha);
    expect(Object.keys(env).filter((key) => /^(?:PRIMARY_|DR_(?!ACCESS)|GOOGLE_CLIENT|LINE_CHANNEL|RESEND_)/.test(key))).toEqual([]);
    expect(env.SESSION_FINGERPRINT_HASH_SECRET).not.toBe(env.OAUTH_STATE_SECRET);
    expect(() => stagingRuntimeConfiguration({ ...input, directUrl: input.directUrl.replace("daeqwtpaxcebmtwxqdkj", "eyuctbnlvnbnivwasvqr") })).toThrow();
  });
  it("rejects the Primary project, Production target and unreviewed source", () => {
    const sha = "a".repeat(40);
    const deployment = { id: "dpl_test", projectId: "prj_GOSwYN5rKhSuD3d4gPJEVtmKt7b3", readyState: "READY",
      target: null, meta: { git_commit: sha, githubCommitSha: sha, githubCommitRef: "staging" } };
    expect(() => assertStagingDeployment(deployment, sha)).not.toThrow();
    for (const change of [{ projectId: "prj_primary" }, { target: "production" }, { meta: { ...deployment.meta, git_commit: "b".repeat(40) } }]) {
      expect(() => assertStagingDeployment({ ...deployment, ...change }, sha)).toThrow("STAGING_DEPLOYMENT_INVALID");
    }
  });
});
