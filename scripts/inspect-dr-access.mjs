// Read-only provider inventory for the owner-approved DR retirement.
const accountId = "b1c70202652cd3b77dfec70e5463785f";
const zoneId = "8f8070a80ad4182e4af0c11a1b496968";
const hosts = ["app.qidaigo.com", "dr.qidaigo.com", "staging.qidaigo.com"];

async function read(path) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN?.trim()}` },
    redirect: "error", signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`CLOUDFLARE_READ_HTTP_${response.status}`);
  const body = await response.json();
  if (!body.success) throw new Error("CLOUDFLARE_READ_UNSUCCESSFUL");
  return body.result;
}

try {
  if (!process.env.CLOUDFLARE_API_TOKEN) throw new Error("CLOUDFLARE_TOKEN_MISSING");
  const zone = await read(`/zones/${zoneId}`);
  if (zone.name !== "qidaigo.com" || zone.account.id !== accountId) throw new Error("CLOUDFLARE_TARGET_MISMATCH");
  const dns = await Promise.all(hosts.map(async (host) => ({
    host, records: (await read(`/zones/${zoneId}/dns_records?name=${host}`)).map(
      ({ id, name, type, content, proxied }) => ({ id, name, type, content, proxied })),
  })));
  const apps = await read(`/accounts/${accountId}/access/apps?per_page=1000`);
  const selected = [];
  for (const app of apps.filter((item) => hosts.includes(item.domain))) {
    const policies = await read(`/accounts/${accountId}/access/apps/${app.id}/policies`);
    selected.push({ id: app.id, domain: app.domain, type: app.type, audience: app.aud,
      policies: policies.map((policy) => ({ id: policy.id, decision: policy.decision,
        includeSelectors: (policy.include ?? []).flatMap(Object.keys),
        requireSelectors: (policy.require ?? []).flatMap(Object.keys) })),
    });
  }
  console.log(JSON.stringify({ event: "dr_access_readback", remoteWrites: false, dns, access: selected }));
} catch (error) {
  const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "CLOUDFLARE_READ_FAILED";
  console.error(JSON.stringify({ event: "dr_access_read_failed", code, remoteWrites: false }));
  process.exitCode = 1;
}
