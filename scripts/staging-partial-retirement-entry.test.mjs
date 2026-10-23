import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { conversionDigest, STAGING_TARGET as target } from "./dr-staging-conversion-plan.mjs";
import { readCurrentPartialEntry } from "./staging-partial-retirement-entry.mjs";

const evidence = vi.hoisted(() => vi.fn());
const primary = vi.hoisted(() => vi.fn());
vi.mock("./staging-partial-retirement-proof.mjs", () => ({ readFailedRetirementEntryEvidence: evidence }));
vi.mock("./dr-staging-conversion-plan.mjs", async original => ({ ...await original(), readConversionPrimary: primary }));
const access = `/accounts/${target.account}/access`;
function fixture() {
  const owner = { decision: "allow", include: [{ cloudflare_account_member: { account_id: target.account } }],
    require: [{ email: { email: "fixture@example.invalid" } }], exclude: [] };
  const baseline = { entry: { appId: "aca3efa4-4177-4b4d-8a34-e733f7cecc33",
    dnsId: "871c47f7090278db84e56ae6da1c1547", qaTokenId: "2f063e5f-5f2a-4ebe-af09-f1a0d21425e1",
    qaPolicyId: "4bcbbc06-babc-404f-bdf9-21c4ca8bb151", sourceSha: "32e9de2cf325240679c1a56f336b4c0f8c9d6664" },
  provider: { idpId: "63bf4fe4-a775-456a-bacd-033b9073007a", teamDomain: "https://fixture.cloudflareaccess.com",
    sourcePolicyId: "352c020e-a0a1-4a11-adf6-04aae60dfdfc", sourcePolicyDigest: conversionDigest(owner),
    protection: "all_except_custom_domains" }, primary: { deploymentId: "fixture-primary", environmentDigest: "private digest" } };
  const records = new Map();
  const cf = (path, result) => records.set(path, { success: true, result, ...(Array.isArray(result)
    ? { result_info: { page: 1, count: result.length, total_count: result.length, total_pages: 1 } } : {}) });
  cf(`/zones/${target.zone}`, { id: target.zone, name: "qidaigo.com", account: { id: target.account } });
  cf(`${access}/organizations`, { auth_domain: "fixture.cloudflareaccess.com" });
  cf(`${access}/identity_providers/${baseline.provider.idpId}`, { id: baseline.provider.idpId, type: "cloudflare",
    config: { restrict_to_account_members: true } });
  cf(`${access}/apps/${baseline.entry.appId}`, { id: baseline.entry.appId, domain: target.host, type: "self_hosted",
    name: "StallOrder Staging 32e9de2cf325", aud: "a".repeat(64), session_duration: "1h",
    auto_redirect_to_identity: true, allowed_idps: [baseline.provider.idpId] });
  cf(`${access}/apps/${baseline.entry.appId}/policies?per_page=1000`, [{ id: "owner-fixture", name: "Restricted Staging owner", precedence: 1, ...owner }]);
  cf(`${access}/service_tokens?per_page=1000`, []);
  cf(`/zones/${target.zone}/dns_records/${baseline.entry.dnsId}`, { id: baseline.entry.dnsId, name: target.host,
    type: "CNAME", content: "cname.vercel-dns.com", proxied: true, ttl: 1 });
  cf(`${access}/apps/${target.oldAccessId}`, { id: target.oldAccessId, domain: "dr.qidaigo.com",
    type: "self_hosted", allowed_idps: [baseline.provider.idpId] });
  cf(`${access}/apps/${target.oldAccessId}/policies?per_page=1000`, [{ id: baseline.provider.sourcePolicyId, ...owner }]);
  cf(`/zones/${target.zone}/dns_records/${target.oldDnsId}`, { id: target.oldDnsId, name: "dr.qidaigo.com",
    type: "CNAME", content: "cname.vercel-dns.com", proxied: true });
  records.set(`/v9/projects/${target.project}`, { id: target.project, accountId: target.team,
    ssoProtection: { deploymentType: "all_except_custom_domains" } });
  records.set(`/v9/projects/${target.project}/env`, { envs: [] });
  records.set(`/v9/projects/${target.project}/domains?limit=100`, { domains: [{ name: target.host, gitBranch: "staging", redirect: null }] });
  records.set(`/v9/projects/${target.primaryProject}/domains?limit=100`, { domains: [{ name: "app.qidaigo.com" }] });
  return { baseline, records };
}
function serve(value, override) {
  evidence.mockReturnValue(value.baseline); primary.mockResolvedValue(value.baseline.primary);
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    const parsed = new URL(url); const path = parsed.pathname.replace(/^\/client\/v4/, "");
    if (parsed.hostname === "api.vercel.com") { expect(parsed.searchParams.get("teamId")).toBe(target.team); parsed.searchParams.delete("teamId"); }
    else expect(parsed.hostname).toBe("api.cloudflare.com");
    const key = `${path}${parsed.search}`; calls.push(key);
    expect(options.method).toBe("GET"); expect(options.redirect).toBe("error"); expect(options.body).toBeUndefined();
    if (override) { const response = override(key); if (response) return response; }
    if (["/v4/aliases/dr.qidaigo.com", "/v4/aliases/stallorder-dr.vercel.app"].includes(key)) {
      return Response.json({ error: { code: "not_found" } }, { status: 404 });
    }
    if (!value.records.has(key)) throw new Error("unexpected target");
    return Response.json(value.records.get(key));
  }));
  return calls;
}
describe("authenticated current partial entry observation", () => {
  beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("VERCEL_TOKEN", "fixture-token"); vi.stubEnv("CLOUDFLARE_API_TOKEN", "fixture-token"); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  it("observes the retained protected entry and exact QA absence without treating it as acceptance or qualification", async () => {
    const value = fixture(); const calls = serve(value);
    const { privateCurrentEntry, ...summary } = await readCurrentPartialEntry({ rawArchives: "fixture" });
    expect(evidence).toHaveBeenCalledExactlyOnceWith({ rawArchives: "fixture" });
    expect(privateCurrentEntry).toBeDefined();
    expect(summary).toEqual({ diagnosticOnly: true, planQualified: false, currentEntryConfigurationMatched: true,
      oldQaTokenAbsent: true, oldQaPolicyAbsent: true, retiredVercelAliasesAbsent: true,
      primaryBaselineMatched: true, humanAccessAcceptanceProven: false, runtimeAcceptanceProven: false });
    expect(JSON.stringify(summary)).not.toMatch(/fixture|private digest|a{64}/);
    expect(calls).toHaveLength(16);
  });

  it("rejects stale QA access and incomplete/ambiguous list responses instead of assuming absence", async () => {
    for (const mutate of [
      v => { v.records.get(`${access}/service_tokens?per_page=1000`).result.push({ id: v.baseline.entry.qaTokenId }); },
      v => { v.records.get(`${access}/apps/${v.baseline.entry.appId}/policies?per_page=1000`).result[0].id = v.baseline.entry.qaPolicyId; },
      v => { delete v.records.get(`${access}/apps/${v.baseline.entry.appId}/policies?per_page=1000`).result[0].id; },
      v => { v.records.get(`${access}/service_tokens?per_page=1000`).result_info.total_count = 1; },
      v => { delete v.records.get(`${access}/service_tokens?per_page=1000`).result_info; },
      v => { v.records.get(`${access}/service_tokens?per_page=1000`).result_info.page = 2; },
      v => { v.records.get(`${access}/service_tokens?per_page=1000`).result_info.total_pages = 2; },
      v => { const p = v.records.get(`${access}/apps/${v.baseline.entry.appId}/policies?per_page=1000`); p.result.push({ decision: "bypass" }); p.result_info.count = p.result_info.total_count = 2; },
    ]) {
      const value = fixture(); mutate(value); serve(value);
      await expect(readCurrentPartialEntry({})).rejects.toThrow(/^STAGING_PARTIAL_ENTRY_(INVALID|READ_FAILED)$/);
    }
  });

  it("rejects owner/IdP/domain/project/protection and preserved old-entry drift", async () => {
    for (const mutate of [
      v => { v.records.get(`/zones/${target.zone}`).result.account.id = "different-account"; },
      v => { v.records.get(`${access}/organizations`).result.auth_domain = "wrong.cloudflareaccess.com"; },
      v => { v.records.get(`${access}/identity_providers/${v.baseline.provider.idpId}`).result.config.restrict_to_account_members = false; },
      v => { v.records.get(`${access}/apps/${v.baseline.entry.appId}`).result.domain = "app.qidaigo.com"; },
      v => { v.records.get(`${access}/apps/${v.baseline.entry.appId}`).result.allowed_idps.push("other-idp"); },
      v => { v.records.get(`${access}/apps/${v.baseline.entry.appId}`).result.auto_redirect_to_identity = false; },
      v => { v.records.get(`${access}/apps/${v.baseline.entry.appId}/policies?per_page=1000`).result[0].require = []; },
      v => { v.records.get(`${access}/apps/${v.baseline.entry.appId}/policies?per_page=1000`).result[0].require[0].email.email = "changed@example.invalid"; },
      v => { v.records.get(`/zones/${target.zone}/dns_records/${v.baseline.entry.dnsId}`).result.proxied = false; },
      v => { v.records.get(`/zones/${target.zone}/dns_records/${target.oldDnsId}`).result.content = "other.invalid"; },
      v => { v.records.get(`${access}/apps/${target.oldAccessId}`).result.id = "other-app"; },
      v => { v.records.get(`${access}/apps/${target.oldAccessId}/policies?per_page=1000`).result[0].id = "other-policy"; },
      v => { v.records.get(`/v9/projects/${target.project}`).id = target.primaryProject; },
      v => { v.records.get(`/v9/projects/${target.project}`).ssoProtection = null; },
      v => { v.records.get(`/v9/projects/${target.project}/env`).envs.push({ key: "PRIVATE_VALUE" }); },
      v => { v.records.get(`/v9/projects/${target.project}/domains?limit=100`).domains[0].gitBranch = "main"; },
      v => { v.records.get(`/v9/projects/${target.project}/domains?limit=100`).domains[0].redirect = "https://app.qidaigo.com"; },
      v => { v.records.get(`/v9/projects/${target.project}/domains?limit=100`).pagination = { next: 123 }; },
      v => { v.records.get(`/v9/projects/${target.primaryProject}/domains?limit=100`).domains.push({ name: target.host }); },
    ]) {
      const value = fixture(); mutate(value); serve(value);
      await expect(readCurrentPartialEntry({})).rejects.toThrow(/^STAGING_PARTIAL_ENTRY_INVALID$/);
    }
  });

  it("requires exact not_found, never treating 401/403/429/server failure or malformed 404 as alias absence", async () => {
    for (const [status, code] of [[200, "not_found"], [401, "not_found"], [403, "forbidden"],
      [429, "not_found"], [500, "not_found"], [404, "permission_denied"]]) {
      serve(fixture(), key => key === "/v4/aliases/dr.qidaigo.com"
        ? Response.json({ error: { code, message: "private provider body" } }, { status }) : null);
      await expect(readCurrentPartialEntry({})).rejects.toThrow(/^STAGING_PARTIAL_ENTRY_READ_FAILED$/);
    }
  });

  it("stops before network on invalid provenance and sanitizes Primary mismatch or private provider failures", async () => {
    serve(fixture()); evidence.mockImplementation(() => { throw new Error("STAGING_PARTIAL_ARCHIVE_INVALID"); });
    await expect(readCurrentPartialEntry({})).rejects.toThrow(/^STAGING_PARTIAL_ARCHIVE_INVALID$/);
    expect(fetch).not.toHaveBeenCalled(); expect(primary).not.toHaveBeenCalled();
    serve(fixture()); primary.mockResolvedValue({ deploymentId: "changed", private: "must not leak" });
    await expect(readCurrentPartialEntry({})).rejects.toThrow(/^STAGING_PARTIAL_ENTRY_INVALID$/);
    serve(fixture()); primary.mockRejectedValue(new Error("private environment contents"));
    await expect(readCurrentPartialEntry({})).rejects.toThrow(/^STAGING_PARTIAL_ENTRY_READ_FAILED$/);
    serve(fixture()); fetch.mockRejectedValue(new Error("private transport credential"));
    await expect(readCurrentPartialEntry({})).rejects.toThrow(/^STAGING_PARTIAL_ENTRY_READ_FAILED$/);
  });
});
