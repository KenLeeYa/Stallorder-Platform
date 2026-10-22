import { describe, expect, it } from "vitest";
import { stagingRuntimeConfiguration, assertStagingDeployment, stagingAliasExceptionRequest } from "./staging-runtime.mjs";

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
  it("permits only the exact JWT-guarded Staging Preview alias, never a project-wide bypass", () => {
    const sourceSha = "a".repeat(40);
    const input = {
      sourceSha,
      alias: { uid: "b".repeat(128), alias: "staging.qidaigo.com", projectId: "prj_GOSwYN5rKhSuD3d4gPJEVtmKt7b3", deploymentId: "dpl_test" },
      deployment: { id: "dpl_test", projectId: "prj_GOSwYN5rKhSuD3d4gPJEVtmKt7b3", readyState: "READY", target: null,
        meta: { git_commit: sourceSha, githubCommitSha: sourceSha, githubCommitRef: "staging" } },
      access: { audience: "c".repeat(64), teamDomain: "https://fixture.cloudflareaccess.com" },
      runtime: { DR_ACCESS_ENFORCEMENT_ENABLED: "true", DR_ACCESS_HOSTNAME: "staging.qidaigo.com",
        CLOUDFLARE_ACCESS_AUD: "c".repeat(64), CLOUDFLARE_ACCESS_TEAM_DOMAIN: "https://fixture.cloudflareaccess.com" },
    };
    const request = stagingAliasExceptionRequest(input);
    expect(request.path).toBe(`/aliases/${input.alias.uid}/protection-bypass`);
    expect(request.options).toEqual({ method: "PATCH", body: JSON.stringify({ override: { action: "create", scope: "alias-protection-override" } }) });
    expect(JSON.parse(stagingAliasExceptionRequest(input, "revoke").options.body).override.action).toBe("revoke");
    for (const change of [
      { alias: { ...input.alias, alias: "app.qidaigo.com" } },
      { alias: { ...input.alias, alias: "generated.vercel.app" } },
      { alias: { ...input.alias, projectId: "prj_primary" } },
      { alias: { ...input.alias, deploymentId: "dpl_other" } },
      { alias: { ...input.alias, uid: "../projects/primary" } },
      { deployment: { ...input.deployment, target: "production" } },
      { sourceSha: "d".repeat(40) },
      { runtime: { ...input.runtime, DR_ACCESS_ENFORCEMENT_ENABLED: "false" } },
      { runtime: { ...input.runtime, DR_ACCESS_HOSTNAME: "dr.qidaigo.com" } },
      { runtime: { ...input.runtime, CLOUDFLARE_ACCESS_AUD: "d".repeat(64) } },
      { runtime: { ...input.runtime, CLOUDFLARE_ACCESS_TEAM_DOMAIN: "https://other.cloudflareaccess.com" } },
    ]) expect(() => stagingAliasExceptionRequest({ ...input, ...change })).toThrow();
    expect(() => stagingAliasExceptionRequest(input, "disable-project-protection")).toThrow();
  });
});
