import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { STAGING_TARGET, RETIRED_HOSTS, conversionApi } from "./dr-staging-conversion-plan.mjs";

export function assertRetiredAlias(alias, expected) {
  assert.ok(RETIRED_HOSTS.includes(expected.host) && alias.alias === expected.host
    && alias.projectId === STAGING_TARGET.project && alias.deploymentId === expected.deploymentId
    && (alias.uid ?? alias.id) === expected.aliasId, "STAGING_RETIRED_ALIAS_CHANGED");
}

export async function detachRetiredEntries(plan, verifyPrimary) {
  assert.deepEqual(plan.providerPrestate.retiredAliases.map((item) => item.host), RETIRED_HOSTS, "STAGING_RETIRED_ALIAS_SCOPE_INVALID");
  for (const expected of plan.providerPrestate.retiredAliases) {
    assertRetiredAlias(await conversionApi("vercel", `/v4/aliases/${expected.host}`), expected);
    const origin = await fetch(`https://${expected.deploymentUrl}/login`, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
    assert.ok(origin.status === 401 || (origin.status === 302
      && origin.headers.get("location")?.startsWith("https://vercel.com/sso-api?")), "STAGING_OLD_ORIGIN_UNPROTECTED");
    await conversionApi("vercel", `/v2/aliases/${expected.host}`, { method: "DELETE" });
    await conversionApi("vercel", `/v9/projects/${STAGING_TARGET.project}/domains/${expected.host}`, { method: "DELETE" });
    await verifyPrimary();
    const remaining = await conversionApi("vercel", `/v2/deployments/${expected.deploymentId}/aliases`);
    assert.ok(!remaining.aliases.some((item) => item.alias === expected.host), "STAGING_OLD_ALIAS_NOT_REMOVED");
  }
  await writeFile("artifacts/staging-retired-aliases.json", JSON.stringify({
    sourceSha: plan.sourceSha, retired: plan.providerPrestate.retiredAliases,
    oldGeneratedOriginSsoProtected: true, primaryWrites: false,
  }, null, 2));
}

export async function retireOldCloudflareEntry(plan, verifyPrimary) {
  const dnsPath = `/zones/${STAGING_TARGET.zone}/dns_records/${STAGING_TARGET.oldDnsId}`;
  const dns = await conversionApi("cloudflare", dnsPath);
  assert.ok(dns.id === STAGING_TARGET.oldDnsId && dns.name === "dr.qidaigo.com"
    && dns.type === "CNAME" && dns.content === "cname.vercel-dns.com" && dns.proxied,
  "STAGING_RETIRED_DNS_CHANGED");
  await conversionApi("cloudflare", dnsPath, { method: "DELETE" });
  assert.equal((await conversionApi("cloudflare", `/zones/${STAGING_TARGET.zone}/dns_records?name=dr.qidaigo.com`)).length, 0,
    "STAGING_RETIRED_DNS_NOT_REMOVED");
  await verifyPrimary();
  const appPath = `/accounts/${STAGING_TARGET.account}/access/apps/${STAGING_TARGET.oldAccessId}`;
  const policies = await conversionApi("cloudflare", `${appPath}/policies`);
  assert.ok(policies.length === 1 && policies[0].id === plan.providerPrestate.sourcePolicyId, "STAGING_RETIRED_ACCESS_CHANGED");
  await conversionApi("cloudflare", appPath, { method: "DELETE" });
  const apps = await conversionApi("cloudflare", `/accounts/${STAGING_TARGET.account}/access/apps?per_page=1000`);
  assert.ok(apps.length < 1000 && !apps.some((app) => app.id === STAGING_TARGET.oldAccessId), "STAGING_RETIRED_ACCESS_NOT_REMOVED");
  await verifyPrimary();
  await writeFile("artifacts/staging-retired-cloudflare-entry.json", JSON.stringify({
    sourceSha: plan.sourceSha, removedDnsId: STAGING_TARGET.oldDnsId,
    removedAccessId: STAGING_TARGET.oldAccessId, primaryWrites: false,
  }, null, 2));
}
