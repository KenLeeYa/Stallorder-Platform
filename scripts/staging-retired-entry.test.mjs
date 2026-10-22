import { afterEach, describe, expect, it, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import { assertRetiredAlias, detachRetiredEntries } from "./staging-retired-entry.mjs";
import { STAGING_TARGET, RETIRED_HOSTS, conversionApi } from "./dr-staging-conversion-plan.mjs";

vi.mock("node:fs/promises", async (original) => ({ ...await original(), writeFile: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function providerFixture() {
  vi.stubEnv("VERCEL_TOKEN", "fixture-placeholder");
  const expected = RETIRED_HOSTS.map((host, i) => ({ host, aliasId: String(i + 1).repeat(128),
    deploymentId: "dpl_fixture", deploymentUrl: "fixture.vercel.app" }));
  const aliases = expected.map(item => ({ alias: item.host, uid: item.aliasId,
    projectId: STAGING_TARGET.project, deploymentId: item.deploymentId }));
  const removed = new Set();
  const writes = [];
  vi.stubGlobal("fetch", vi.fn(async (input, options = {}) => {
    const url = new URL(input);
    const method = options.method ?? "GET";
    if (url.host === "fixture.vercel.app") return new Response("", { status: 302,
      headers: { location: "https://vercel.com/sso-api?url=fixture" } });
    expect(url.host).toBe("api.vercel.com");
    expect(url.searchParams.get("teamId")).toBe(STAGING_TARGET.team);
    if (method === "DELETE") writes.push(url.pathname);
    if (url.pathname.startsWith("/v4/aliases/")) {
      const id = url.pathname.split("/").at(-1);
      const index = expected.findIndex(item => item.aliasId === id || item.host === id);
      return Response.json(aliases[index]);
    }
    if (url.pathname.startsWith("/v2/aliases/") && method === "DELETE") {
      const item = expected.find(item => item.aliasId === url.pathname.split("/").at(-1));
      if (!item) return Response.json({ error: { code: "not_found" } }, { status: 404 });
      removed.add(item.host);
      return Response.json({ status: "SUCCESS" });
    }
    if (url.pathname.startsWith(`/v9/projects/${STAGING_TARGET.project}/domains/`)) {
      return Response.json({ name: url.pathname.split("/").at(-1), projectId: STAGING_TARGET.project });
    }
    if (url.pathname === "/v2/deployments/dpl_fixture/aliases") {
      return Response.json({ aliases: aliases.filter(item => !removed.has(item.alias)) });
    }
    throw new Error("UNEXPECTED_FIXTURE_REQUEST");
  }));
  return { aliases, expected, writes, plan: { sourceSha: "a".repeat(40), providerPrestate: { retiredAliases: expected } } };
}

describe("retired DR public aliases", () => {
  it("deletes the bound alias ID when a provider accepts hostname reads but not hostname deletes", async () => {
    const fixture = providerFixture();
    const primary = vi.fn();
    await detachRetiredEntries(fixture.plan, primary);
    expect(fixture.writes).toEqual(fixture.expected.flatMap(item => [
      `/v2/aliases/${item.aliasId}`, `/v9/projects/${STAGING_TARGET.project}/domains/${item.host}`,
    ]));
    expect(primary).toHaveBeenCalledTimes(2);
    expect(JSON.parse(vi.mocked(writeFile).mock.calls[0][1])).toMatchObject({ primaryWrites: false });
  });
  it.each(["primary-project", "primary-host", "staging-host", "changed-id"])(
    "blocks %s at the actual alias-ID deletion boundary", async change => {
      const fixture = providerFixture();
      if (change === "primary-project") fixture.aliases[0].projectId = STAGING_TARGET.primaryProject;
      if (change === "primary-host") fixture.aliases[0].alias = "app.qidaigo.com";
      if (change === "staging-host") fixture.aliases[0].alias = STAGING_TARGET.host;
      if (change === "changed-id") fixture.aliases[0].uid = "f".repeat(128);
      await expect(conversionApi("vercel", `/v2/aliases/${fixture.expected[0].aliasId}`, { method: "DELETE" }))
        .rejects.toThrow("STAGING_WRITE_HOST_INVALID");
      expect(fixture.writes).toEqual([]);
    },
  );
  it("reports a failed provider method/path without response bodies, credentials or query values", async () => {
    providerFixture();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: "private-provider-response" }, { status: 404 }));
    await expect(conversionApi("vercel", "/v9/projects/fixture?private=query-value"))
      .rejects.toThrow("STAGING_VERCEL_HTTP_404");
    expect(log).toHaveBeenCalledWith(JSON.stringify({ provider: "vercel", method: "GET", path: "/v9/projects/fixture", status: 404 }));
  });
  it("requires the exact backed-up alias, deployment and DR project before detaching", () => {
    const expected = { host: "dr.qidaigo.com", aliasId: "fixture-alias", deploymentId: "dpl_fixture" };
    const alias = { alias: expected.host, uid: expected.aliasId, deploymentId: expected.deploymentId, projectId: STAGING_TARGET.project };
    expect(() => assertRetiredAlias(alias, expected)).not.toThrow();
    for (const change of [{ alias: "app.qidaigo.com" }, { projectId: STAGING_TARGET.primaryProject },
      { uid: "changed" }, { deploymentId: "dpl_other" }]) {
      expect(() => assertRetiredAlias({ ...alias, ...change }, expected)).toThrow("STAGING_RETIRED_ALIAS_CHANGED");
    }
  });
});
