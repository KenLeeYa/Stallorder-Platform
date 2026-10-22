import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { readStagingAccess } from "./staging-access-entry.mjs";
import { conversionApi } from "./dr-staging-conversion-plan.mjs";
import { verifyStagingEntryTls } from "./staging-runtime.mjs";

vi.mock("node:fs/promises", async (original) => ({ ...await original(), readFile: vi.fn(), writeFile: vi.fn() }));
vi.mock("./staging-access-entry.mjs", async (original) => ({ ...await original(), readStagingAccess: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

function setup(status = 403) {
  vi.useFakeTimers();
  const sourceSha = "a".repeat(40);
  const alias = { uid: "b".repeat(128), alias: "staging.qidaigo.com", projectId: "prj_GOSwYN5rKhSuD3d4gPJEVtmKt7b3", deploymentId: "dpl_fixture" };
  const deployment = { id: alias.deploymentId, projectId: alias.projectId, readyState: "READY", target: null,
    meta: { git_commit: sourceSha, githubCommitSha: sourceSha, githubCommitRef: "staging" } };
  const project = { id: alias.projectId, ssoProtection: { deploymentType: "all_except_custom_domains" } };
  const access = { audience: "c".repeat(64), teamDomain: "https://fixture.cloudflareaccess.com", dnsId: "d".repeat(32) };
  const runtime = { DR_ACCESS_ENFORCEMENT_ENABLED: "true", DR_ACCESS_HOSTNAME: alias.alias,
    CLOUDFLARE_ACCESS_AUD: access.audience, CLOUDFLARE_ACCESS_TEAM_DOMAIN: access.teamDomain };
  vi.mocked(readStagingAccess).mockResolvedValue(access);
  vi.mocked(readFile).mockResolvedValue(JSON.stringify(runtime));
  for (const key of ["VERCEL_TOKEN", "CLOUDFLARE_API_TOKEN"]) vi.stubEnv(key, "fixture-placeholder");
  vi.stubEnv("GITHUB_SHA", sourceSha);
  const writes = [];
  let overridden = false;
  vi.stubGlobal("fetch", vi.fn(async (input, options = {}) => {
    const url = new URL(input);
    const method = options.method ?? "GET";
    const body = options.body ? JSON.parse(options.body) : null;
    if (method !== "GET") writes.push({ host: url.host, path: url.pathname, method, body });
    if (url.host === "api.vercel.com") {
      if (url.pathname === `/v9/projects/${project.id}`) return Response.json(project);
      if (url.pathname.startsWith("/v4/aliases/")) return Response.json({ ...alias,
        protectionBypass: overridden ? { fixture: { scope: "alias-protection-override" } } : {} });
      if (url.pathname === `/v13/deployments/${deployment.id}`) return Response.json(deployment);
      if (url.pathname === `/aliases/${alias.uid}/protection-bypass` && method === "PATCH") {
        overridden = body.override.action === "create";
        return Response.json({});
      }
    }
    if (url.host === "api.cloudflare.com" && url.pathname.endsWith(`/dns_records/${access.dnsId}`)) {
      return Response.json({ success: true, result: { name: "staging.qidaigo.com", type: "CNAME", content: "cname.vercel-dns.com" } });
    }
    if (url.host === "staging.qidaigo.com" && url.pathname === "/login") {
      return overridden ? new Response("", { status, headers: { server: "Vercel" } })
        : new Response("", { status: 302, headers: { location: "https://vercel.com/sso-api", server: "Vercel" } });
    }
    throw new Error("UNEXPECTED_FIXTURE_REQUEST");
  }));
  return { sourceSha, alias, deployment, project, writes, overridden: () => overridden };
}

describe("Staging Preview Access handoff at the provider boundary", () => {
  it("reaches origin JWT denial instead of Vercel SSO without changing project protection", async () => {
    const fixture = setup();
    const primary = vi.fn();
    const verified = expect(verifyStagingEntryTls({ sourceSha: fixture.sourceSha }, primary)).resolves.toBeUndefined();
    await Promise.all([verified, vi.runAllTimersAsync()]);
    expect(fixture.overridden()).toBe(true);
    expect(fixture.writes.map((write) => write.body)).toEqual([
      { override: { action: "create", scope: "alias-protection-override" } },
      { proxied: false, ttl: 60 }, { proxied: true, ttl: 1 },
    ]);
    expect(fixture.writes.some((write) => write.path.includes("/projects/"))).toBe(false);
    expect(primary).toHaveBeenCalledTimes(2);
    expect(JSON.parse(vi.mocked(writeFile).mock.calls[0][1])).toMatchObject({
      aliasId: fixture.alias.uid, hostname: "staging.qidaigo.com", anonymousOriginJwtDenied: true, primaryWrites: false,
    });
  });
  it("revokes the exact exception and restores the proxy if anonymous origin access is exposed", async () => {
    const fixture = setup(200);
    const rejected = expect(verifyStagingEntryTls({ sourceSha: fixture.sourceSha }, vi.fn())).rejects.toThrow("STAGING_ORIGIN_EXPOSED");
    await Promise.all([rejected, vi.runAllTimersAsync()]);
    expect(fixture.overridden()).toBe(false);
    expect(fixture.writes.at(-2).body).toEqual({ override: { action: "revoke", scope: "alias-protection-override" } });
    expect(fixture.writes.at(-1).body).toEqual({ proxied: true, ttl: 1 });
    expect(writeFile).not.toHaveBeenCalled();
  });
  it("refuses to transfer an alias if generated-URL protection has changed", async () => {
    const fixture = setup();
    fixture.project.ssoProtection = null;
    await expect(verifyStagingEntryTls({ sourceSha: fixture.sourceSha }, vi.fn()))
      .rejects.toThrow("STAGING_GENERATED_ORIGIN_PROTECTION_CHANGED");
    expect(fixture.writes).toEqual([]);
  });
  it.each(["primary-host", "primary-project", "production-target", "source-drift", "wrong-body"])(
    "blocks %s at the actual API write boundary", async (change) => {
      const fixture = setup();
      if (change === "primary-host") fixture.alias.alias = "app.qidaigo.com";
      if (change === "primary-project") fixture.alias.projectId = "prj_primary";
      if (change === "production-target") fixture.deployment.target = "production";
      if (change === "source-drift") fixture.deployment.meta.git_commit = "e".repeat(40);
      const body = change === "wrong-body" ? { generate: { note: "not-allowed" } }
        : { override: { action: "create", scope: "alias-protection-override" } };
      await expect(conversionApi("vercel", `/aliases/${fixture.alias.uid}/protection-bypass`, {
        method: "PATCH", body: JSON.stringify(body),
      })).rejects.toThrow();
      expect(fixture.writes).toEqual([]);
    },
  );
});
