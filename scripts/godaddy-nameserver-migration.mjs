import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

const apply = process.argv.includes("--apply");
const zoneName = process.env.DOMAIN_ZONE ?? "qidaigo.com";
const vercelCnameTarget = process.env.VERCEL_CNAME_TARGET ?? "6b2c35820840b357.vercel-dns-017.com";
const vercelApexA = process.env.VERCEL_APEX_A ?? "216.198.79.1";
const cloudflareToken = process.env.CLOUDFLARE_API_TOKEN ?? process.env.CF_API_TOKEN;
const configuredZoneId = process.env.CLOUDFLARE_ZONE_ID ?? process.env.CF_ZONE_ID;
const godaddyPat = process.env.GODADDY_PAT ?? process.env.GODADDY_API_TOKEN;

const requiredRecords = [
  { type: "CNAME", name: "app", content: vercelCnameTarget },
  { type: "CNAME", name: "www", content: vercelCnameTarget },
  { type: "A", name: "@", content: vercelApexA },
];

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function requireTokens() {
  if (!cloudflareToken) fail("missing CLOUDFLARE_API_TOKEN or CF_API_TOKEN");
  if (!godaddyPat) {
    if (process.env.GODADDY_API_KEY || process.env.GODADDY_API_SECRET) {
      fail("GoDaddy Domains v3 requires GODADDY_PAT bearer token; key/secret credentials are not used by this automation.");
    }
    fail("missing GODADDY_PAT or GODADDY_API_TOKEN");
  }
}

async function cloudflare(path) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { authorization: `Bearer ${cloudflareToken}`, "content-type": "application/json" },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    const message = payload?.errors?.map((error) => error.message).join("; ") || `HTTP ${response.status}`;
    fail(`Cloudflare API failed for ${path}: ${message}`);
  }
  return payload.result;
}

async function godaddy(path, options = {}) {
  const response = await fetch(`https://api.godaddy.com/v3/domains${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${godaddyPat}`,
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.message || payload?.error || `HTTP ${response.status}`;
    fail(`GoDaddy API failed for ${path}: ${message}`);
  }
  return payload;
}

async function findZone() {
  if (configuredZoneId) {
    const zone = await cloudflare(`/zones/${configuredZoneId}`);
    if (zone.name !== zoneName) fail(`CLOUDFLARE_ZONE_ID belongs to ${zone.name}, expected ${zoneName}`);
    return zone;
  }
  const zones = await cloudflare(`/zones?name=${encodeURIComponent(zoneName)}&per_page=50`);
  if (zones.length === 0) fail(`Cloudflare zone ${zoneName} was not found.`);
  if (zones.length > 1) fail(`multiple Cloudflare zones found for ${zoneName}; set CLOUDFLARE_ZONE_ID explicitly`);
  return zones[0];
}

async function listCloudflareRecords(zoneId) {
  const records = [];
  let page = 1;
  while (true) {
    const result = await cloudflare(`/zones/${zoneId}/dns_records?per_page=100&page=${page}`);
    records.push(...result);
    if (result.length < 100) break;
    page += 1;
  }
  return records;
}

function fqdn(recordName) {
  return recordName === "@" ? zoneName : `${recordName}.${zoneName}`;
}

function normalized(value) {
  return String(value ?? "").replace(/\.$/, "").toLowerCase();
}

function assertCloudflareDnsReady(records) {
  const problems = [];
  for (const required of requiredRecords) {
    const name = fqdn(required.name).toLowerCase();
    const matches = records.filter((record) => record.name.toLowerCase() === name);
    const exact = matches.find((record) => (
      record.type === required.type
      && normalized(record.content) === normalized(required.content)
      && record.proxied === false
    ));
    const conflicting = matches.filter((record) => {
      if (record.type === "TXT" || record.type === "MX" || record.type === "CAA") return false;
      if (required.type === "CNAME") return record.type !== "CNAME" || normalized(record.content) !== normalized(required.content);
      return ["A", "AAAA", "CNAME"].includes(record.type)
        && (record.type !== required.type || normalized(record.content) !== normalized(required.content));
    });
    if (!exact) problems.push(`missing DNS-only ${required.type} ${required.name} -> ${required.content}`);
    if (conflicting.length > 0) problems.push(`conflicting records exist for ${name}: ${conflicting.map((record) => record.type).join(", ")}`);
  }
  if (problems.length > 0) {
    fail(`Cloudflare DNS is not ready for nameserver cutover: ${problems.join("; ")}`);
  }
}

function sameNameservers(left, right) {
  const normalizeList = (values) => values.map((value) => normalized(value)).sort();
  return JSON.stringify(normalizeList(left)) === JSON.stringify(normalizeList(right));
}

async function updateGoDaddyNameservers(targetNameservers) {
  const idempotencyKey = randomUUID();
  const requestId = randomUUID();
  const operation = await godaddy(`/domain-names/${encodeURIComponent(zoneName)}/nameservers`, {
    method: "PUT",
    headers: {
      "Idempotency-Key": idempotencyKey,
      "X-Request-Id": requestId,
    },
    body: JSON.stringify(targetNameservers),
  });
  console.log(`GoDaddy operation: ${operation.operationId ?? operation.id ?? "submitted"}`);
  if (!operation.operationId) return;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 5000));
    const current = await godaddy(`/operations/${encodeURIComponent(operation.operationId)}`);
    console.log(`GoDaddy operation status: ${current.status ?? "unknown"}`);
    if (current.status === "COMPLETED") return;
    if (current.status === "FAILED") fail(`GoDaddy nameserver operation failed: ${current.error?.message ?? "unknown error"}`);
  }
  console.log("GoDaddy operation still pending; check GoDaddy domain status before retrying.");
}

async function main() {
  console.log(apply ? "Mode: APPLY" : "Mode: DRY-RUN");
  console.log(`Domain: ${zoneName}`);
  requireTokens();

  const zone = await findZone();
  if (!Array.isArray(zone.name_servers) || zone.name_servers.length < 2) {
    fail("Cloudflare did not return assigned nameservers.");
  }
  const records = await listCloudflareRecords(zone.id);
  assertCloudflareDnsReady(records);

  const domain = await godaddy(`/domain-names/${encodeURIComponent(zoneName)}`);
  const currentNameservers = domain.nameServers ?? domain.nameservers ?? [];
  const targetNameservers = zone.name_servers;
  if (!Array.isArray(currentNameservers) || currentNameservers.length === 0) {
    fail("GoDaddy did not return current nameservers; stop before cutover.");
  }

  const plan = {
    generatedAt: new Date().toISOString(),
    mode: apply ? "apply" : "dry-run",
    domain: zoneName,
    cloudflareZone: {
      id: zone.id,
      name: zone.name,
      status: zone.status,
      nameServers: targetNameservers,
    },
    godaddy: {
      status: domain.status,
      currentNameservers,
      targetNameservers,
      alreadyCutOver: sameNameservers(currentNameservers, targetNameservers),
    },
    rollback: {
      action: "restore previous GoDaddy nameservers",
      nameservers: currentNameservers,
    },
    safeguards: [
      "Cloudflare DNS records for app, www, and apex must already match Vercel and be DNS only.",
      "This automation does not enable Cloudflare Proxy.",
      "This automation does not enable DNSSEC.",
      "Do not retry a submitted GoDaddy operation unless polling confirms failure.",
    ],
  };

  mkdirSync(resolve("artifacts"), { recursive: true });
  writeFileSync(resolve("artifacts/godaddy-nameserver-plan.json"), `${JSON.stringify(plan, null, 2)}\n`);

  console.log(`GoDaddy status: ${domain.status ?? "unknown"}`);
  console.log(`Current nameservers: ${currentNameservers.join(", ")}`);
  console.log(`Target nameservers: ${targetNameservers.join(", ")}`);
  console.log("Plan file: artifacts/godaddy-nameserver-plan.json");

  if (sameNameservers(currentNameservers, targetNameservers)) {
    console.log("No changes needed: GoDaddy already uses the Cloudflare nameservers.");
    return;
  }
  if (!apply) {
    console.log("No changes applied. Re-run npm run registrar:nameservers:apply after reviewing the plan.");
    return;
  }
  await updateGoDaddyNameservers(targetNameservers);
  console.log("Done: GoDaddy nameserver update submitted.");
}

main().catch((error) => fail(error instanceof Error ? error.message : "unknown error"));
