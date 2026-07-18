import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const apply = process.argv.includes("--apply");
const zoneName = process.env.DOMAIN_ZONE ?? "qidaigo.com";
const primaryHost = process.env.DOMAIN_PRIMARY_HOST ?? "app.qidaigo.com";
const rootHost = process.env.DOMAIN_ROOT_HOST ?? "qidaigo.com";
const wwwHost = process.env.DOMAIN_WWW_HOST ?? "www.qidaigo.com";
const vercelCnameTarget = process.env.VERCEL_CNAME_TARGET ?? "6b2c35820840b357.vercel-dns-017.com";
const vercelApexA = process.env.VERCEL_APEX_A ?? "216.198.79.1";
const token = process.env.CLOUDFLARE_API_TOKEN ?? process.env.CF_API_TOKEN;
const configuredZoneId = process.env.CLOUDFLARE_ZONE_ID ?? process.env.CF_ZONE_ID;

const requiredRecords = [
  { hostname: primaryHost, type: "CNAME", name: "app", content: vercelCnameTarget },
  { hostname: wwwHost, type: "CNAME", name: "www", content: vercelCnameTarget },
  { hostname: rootHost, type: "A", name: "@", content: vercelApexA },
];

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function apiHeaders() {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function cloudflare(path, options = {}) {
  if (!token) fail("missing CLOUDFLARE_API_TOKEN or CF_API_TOKEN");
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...options,
    headers: { ...apiHeaders(), ...(options.headers ?? {}) },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    const message = payload?.errors?.map((error) => error.message).join("; ") || `HTTP ${response.status}`;
    fail(`Cloudflare API failed for ${path}: ${message}`);
  }
  return payload.result;
}

function fqdn(recordName) {
  if (recordName === "@") return zoneName;
  return `${recordName}.${zoneName}`;
}

function isEmailOrOwnershipRecord(record) {
  const name = record.name.toLowerCase();
  const content = String(record.content ?? "").toLowerCase();
  return record.type === "MX"
    || record.type === "CAA"
    || (record.type === "TXT" && (
      name === zoneName
      || name.startsWith("_dmarc.")
      || content.includes("v=spf1")
      || content.includes("dkim")
      || content.includes("google-site-verification")
      || content.includes("facebook-domain-verification")
      || content.includes("atlassian-domain-verification")
    ))
    || name.includes("._domainkey.");
}

function comparableContent(value) {
  return String(value ?? "").replace(/\.$/, "").toLowerCase();
}

function classifyRequiredRecord(required, records) {
  const name = fqdn(required.name).toLowerCase();
  const existing = records.filter((record) => record.name.toLowerCase() === name);
  const sameType = existing.filter((record) => record.type === required.type);
  const conflicting = existing.filter((record) => {
    if (isEmailOrOwnershipRecord(record)) return false;
    if (required.type === "CNAME") return ["A", "AAAA"].includes(record.type);
    return ["A", "AAAA", "CNAME"].includes(record.type) && record.type !== required.type;
  });

  if (conflicting.length > 0) {
    return {
      action: "BLOCKED_CONFLICT",
      required,
      existing,
      reason: `remove or review conflicting ${conflicting.map((record) => record.type).join(", ")} record(s) first`,
    };
  }
  if (sameType.length > 1) {
    return {
      action: "BLOCKED_DUPLICATE",
      required,
      existing,
      reason: `duplicate ${required.type} records exist for ${name}`,
    };
  }
  if (sameType.length === 1) {
    const record = sameType[0];
    const matches = comparableContent(record.content) === comparableContent(required.content)
      && record.proxied === false;
    return {
      action: matches ? "NOOP" : "UPDATE",
      required,
      existing: [record],
      before: {
        id: record.id,
        type: record.type,
        name: record.name,
        content: record.content,
        proxied: record.proxied,
      },
    };
  }
  return { action: "CREATE", required, existing: [] };
}

async function findZone() {
  if (configuredZoneId) {
    const zone = await cloudflare(`/zones/${configuredZoneId}`);
    if (zone.name !== zoneName) fail(`CLOUDFLARE_ZONE_ID belongs to ${zone.name}, expected ${zoneName}`);
    return zone;
  }
  const zones = await cloudflare(`/zones?name=${encodeURIComponent(zoneName)}&per_page=50`);
  if (zones.length === 0) fail(`Cloudflare zone ${zoneName} was not found. Add the site in Cloudflare first.`);
  if (zones.length > 1) fail(`multiple Cloudflare zones found for ${zoneName}; set CLOUDFLARE_ZONE_ID explicitly`);
  return zones[0];
}

async function listDnsRecords(zoneId) {
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

function planRollback(step) {
  if (step.action === "CREATE") {
    return `delete created ${step.required.type} ${step.required.name}`;
  }
  if (step.action === "UPDATE") {
    return `restore ${step.before.type} ${step.before.name} to previous content and proxied=${step.before.proxied}`;
  }
  return "no write";
}

async function applyStep(zoneId, step) {
  const payload = {
    type: step.required.type,
    name: step.required.name,
    content: step.required.content,
    ttl: 1,
    proxied: false,
    comment: "Managed by StallOrder domain migration automation",
  };
  if (step.action === "CREATE") {
    await cloudflare(`/zones/${zoneId}/dns_records`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return;
  }
  if (step.action === "UPDATE") {
    await cloudflare(`/zones/${zoneId}/dns_records/${step.before.id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }
}

async function main() {
  console.log(apply ? "Mode: APPLY" : "Mode: DRY-RUN");
  console.log(`Zone: ${zoneName}`);
  console.log(`Primary: ${primaryHost}`);
  console.log("Cloudflare proxy: forced DNS only");

  const zone = await findZone();
  const records = await listDnsRecords(zone.id);
  const steps = requiredRecords.map((record) => classifyRequiredRecord(record, records));
  const blocked = steps.filter((step) => step.action.startsWith("BLOCKED"));

  const plan = {
    generatedAt: new Date().toISOString(),
    mode: apply ? "apply" : "dry-run",
    zone: { id: zone.id, name: zone.name, status: zone.status, nameServers: zone.name_servers ?? [] },
    requiredRecords,
    steps: steps.map((step) => ({
      action: step.action,
      required: step.required,
      reason: step.reason,
      before: step.before,
      rollback: planRollback(step),
    })),
    manualActions: [
      "If Cloudflare zone is not Active, update GoDaddy nameservers to Cloudflare's assigned nameservers.",
      "Keep MX, SPF, DKIM, DMARC, email bounce, and ownership records unchanged.",
      "Do not enable Cloudflare Proxy until Vercel reports domain verified and HTTPS certificate active.",
      "Do not enable DNSSEC until Cloudflare zone status is Active.",
      "After DNS changes, verify in Vercel and run production smoke tests.",
    ],
  };

  mkdirSync(resolve("artifacts"), { recursive: true });
  writeFileSync(resolve("artifacts/domain-migration-plan.json"), `${JSON.stringify(plan, null, 2)}\n`);

  for (const step of steps) {
    const detail = `${step.required.type} ${step.required.name} -> ${step.required.content}`;
    console.log(`${step.action}: ${detail}${step.reason ? ` (${step.reason})` : ""}`);
  }
  console.log(`Cloudflare zone status: ${zone.status}`);
  if (zone.name_servers?.length) {
    console.log(`Cloudflare nameservers: ${zone.name_servers.join(", ")}`);
  }
  console.log("Plan file: artifacts/domain-migration-plan.json");

  if (blocked.length > 0) {
    fail("DNS conflicts detected. Resolve the blocking records manually before applying.");
  }
  if (!apply) {
    console.log("No changes applied. Re-run npm run domain:migration:apply after reviewing the plan.");
    return;
  }
  for (const step of steps) {
    if (step.action === "CREATE" || step.action === "UPDATE") await applyStep(zone.id, step);
  }
  console.log("Done: Cloudflare DNS records applied as DNS only.");
}

main().catch((error) => fail(error instanceof Error ? error.message : "unknown error"));
