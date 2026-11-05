// Read-only partial-state observation. No token creation/deletion or entry repair.
import { isDeepStrictEqual } from "node:util";
import { STAGING_TARGET as target, RETIRED_HOSTS, conversionDigest, conversionRequired,
  readConversionPrimary, stagingOwnerPolicy } from "./dr-staging-conversion-plan.mjs";
import { normalizeProtectedSecret } from "./lib/protected-secret.mjs";
import { readFailedRetirementEntryEvidence } from "./staging-partial-retirement-proof.mjs";

function requireEntry(condition) {
  if (!condition) throw new Error("STAGING_PARTIAL_ENTRY_INVALID");
}
// Private GET transport preserves pagination and distinguishes exact Vercel
// not_found from permission/rate-limit/server failures. No arbitrary caller URL.
async function get(provider, path, absent = false) {
  const cloudflare = provider === "cloudflare";
  const name = cloudflare ? "CLOUDFLARE_API_TOKEN" : "VERCEL_TOKEN";
  const { value } = normalizeProtectedSecret(conversionRequired(name), name);
  const base = cloudflare ? "https://api.cloudflare.com/client/v4" : "https://api.vercel.com";
  const suffix = cloudflare ? "" : `${path.includes("?") ? "&" : "?"}teamId=${target.team}`;
  const response = await fetch(`${base}${path}${suffix}`, { method: "GET", redirect: "error",
    headers: { authorization: `Bearer ${value}` }, signal: AbortSignal.timeout(60_000) });
  const text = await response.text(); requireEntry(text.length <= 1_048_576);
  const body = JSON.parse(text);
  if (absent) {
    requireEntry(!cloudflare && response.status === 404 && body?.error?.code === "not_found");
    return null;
  }
  requireEntry(response.status === 200);
  if (!cloudflare) return body;
  requireEntry(body?.success === true);
  if (Array.isArray(body.result)) {
    const info = body.result_info;
    requireEntry(body.result.length < 1000 && info?.count === body.result.length
      && info.total_count === body.result.length && (info.page === undefined || info.page === 1)
      && (info.total_pages === undefined || info.total_pages === 0 || info.total_pages === 1));
  }
  return body.result;
}

export async function readCurrentPartialEntry(input) {
  // Authenticate first, before even reading a provider token or making a GET.
  const baseline = readFailedRetirementEntryEvidence(input);
  const { entry, provider } = baseline;
  const access = `/accounts/${target.account}/access`;
  let reads, primary;
  try {
    reads = await Promise.all([
      get("cloudflare", `/zones/${target.zone}`), get("cloudflare", `${access}/organizations`),
      get("cloudflare", `${access}/identity_providers/${provider.idpId}`),
      get("cloudflare", `${access}/apps/${entry.appId}`),
      get("cloudflare", `${access}/apps/${entry.appId}/policies?per_page=1000`),
      get("cloudflare", `${access}/service_tokens?per_page=1000`),
      get("cloudflare", `/zones/${target.zone}/dns_records/${entry.dnsId}`),
      get("cloudflare", `${access}/apps/${target.oldAccessId}`),
      get("cloudflare", `${access}/apps/${target.oldAccessId}/policies?per_page=1000`),
      get("cloudflare", `/zones/${target.zone}/dns_records/${target.oldDnsId}`),
      get("vercel", `/v9/projects/${target.project}`), get("vercel", `/v9/projects/${target.project}/env`),
      get("vercel", `/v9/projects/${target.project}/domains?limit=100`),
      get("vercel", `/v9/projects/${target.primaryProject}/domains?limit=100`),
      ...RETIRED_HOSTS.map(host => get("vercel", `/v4/aliases/${host}`, true)),
    ]);
    primary = await readConversionPrimary();
  } catch {
    throw new Error("STAGING_PARTIAL_ENTRY_READ_FAILED");
  }
  try {
    const [zone, organization, idp, app, policies, tokens, dns, oldApp, oldPolicies, oldDns,
      project, environment, domains, primaryDomains] = reads;
    requireEntry(zone.id === target.zone && zone.name === "qidaigo.com" && zone.account?.id === target.account);
    requireEntry(`https://${organization.auth_domain?.replace(/^https:\/\//, "").replace(/\/$/, "")}` === provider.teamDomain
      && idp.id === provider.idpId && idp.type === "cloudflare" && idp.config?.restrict_to_account_members === true);
    requireEntry(app.id === entry.appId && app.domain === target.host && app.type === "self_hosted"
      && app.name === `StallOrder Staging ${entry.sourceSha.slice(0, 12)}` && /^[a-f0-9]{64}$/.test(app.aud)
      && app.session_duration === "1h" && app.auto_redirect_to_identity === true
      && isDeepStrictEqual(app.allowed_idps, [provider.idpId]));
    requireEntry(Array.isArray(policies) && policies.length === 1
      && typeof policies[0].id === "string" && policies[0].id.length > 0 && policies[0].id !== entry.qaPolicyId
      && policies[0].name === "Restricted Staging owner" && policies[0].precedence === 1
      && conversionDigest(stagingOwnerPolicy(policies[0])) === provider.sourcePolicyDigest);
    requireEntry(Array.isArray(tokens) && tokens.every(token => typeof token?.id === "string" && token.id !== entry.qaTokenId)
      && new Set(tokens.map(token => token.id)).size === tokens.length);
    requireEntry(dns.id === entry.dnsId && dns.name === target.host && dns.type === "CNAME"
      && dns.content === "cname.vercel-dns.com" && dns.proxied === true && dns.ttl === 1);
    // These old Cloudflare resources are retired only after runtime acceptance,
    // which the exact failed checkpoint prefix proves was never reached.
    requireEntry(oldApp.id === target.oldAccessId && oldApp.domain === "dr.qidaigo.com" && oldApp.type === "self_hosted"
      && isDeepStrictEqual(oldApp.allowed_idps, [provider.idpId]) && Array.isArray(oldPolicies) && oldPolicies.length === 1
      && oldPolicies[0].id === provider.sourcePolicyId
      && conversionDigest(stagingOwnerPolicy(oldPolicies[0])) === provider.sourcePolicyDigest);
    requireEntry(oldDns.id === target.oldDnsId && oldDns.name === "dr.qidaigo.com" && oldDns.type === "CNAME"
      && oldDns.content === "cname.vercel-dns.com" && oldDns.proxied === true);
    requireEntry(project.id === target.project && project.accountId === target.team
      && project.ssoProtection?.deploymentType === provider.protection && provider.protection === "all_except_custom_domains"
      && Array.isArray(environment.envs) && environment.envs.length === 0 && !environment.pagination?.next);
    requireEntry(Array.isArray(domains.domains) && domains.domains.length === 1 && !domains.pagination?.next
      && domains.domains[0].name === target.host && domains.domains[0].gitBranch === "staging" && !domains.domains[0].redirect
      && Array.isArray(primaryDomains.domains) && !primaryDomains.pagination?.next
      && !primaryDomains.domains.some(domain => [target.host, ...RETIRED_HOSTS].includes(domain.name)));
    requireEntry(isDeepStrictEqual(primary, baseline.primary));
  } catch {
    throw new Error("STAGING_PARTIAL_ENTRY_INVALID");
  }
  return { diagnosticOnly: true, planQualified: false, currentEntryConfigurationMatched: true,
    oldQaTokenAbsent: true, oldQaPolicyAbsent: true, retiredVercelAliasesAbsent: true,
    primaryBaselineMatched: true, humanAccessAcceptanceProven: false, runtimeAcceptanceProven: false,
    privateCurrentEntry: { reads, primary } };
}
