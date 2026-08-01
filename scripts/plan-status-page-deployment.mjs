import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const hostname = "status.qidaigo.com";
const serviceName = "stallorder-status";
const token = required("CLOUDFLARE_API_TOKEN");
const accountId = identifier("CLOUDFLARE_ACCOUNT_ID");
const zoneId = identifier("CLOUDFLARE_ZONE_ID");

try {
  const verification = await verifyToken();
  const [account, zone, dnsRecords, domains] = await Promise.all([
    cloudflare(`/accounts/${accountId}`),
    cloudflare(`/zones/${zoneId}`),
    cloudflare(`/zones/${zoneId}/dns_records?name=${encodeURIComponent(hostname)}&per_page=100`),
    cloudflare(`/accounts/${accountId}/workers/domains?hostname=${encodeURIComponent(hostname)}`),
  ]);
  if (verification.status !== "active") throw new Error("CLOUDFLARE_TOKEN_INACTIVE");
  if (!account?.name) throw new Error("CLOUDFLARE_ACCOUNT_NOT_ACCESSIBLE");
  if (zone?.name !== "qidaigo.com") throw new Error("CLOUDFLARE_ZONE_MISMATCH");
  if (zone?.status !== "active") throw new Error("CLOUDFLARE_ZONE_NOT_ACTIVE");

  const matchingDomains = Array.isArray(domains)
    ? domains.filter((entry) => entry.hostname === hostname)
    : [];
  const conflictingDomain = matchingDomains.find((entry) => entry.service !== serviceName);
  if (conflictingDomain) throw new Error("STATUS_HOSTNAME_ASSIGNED_TO_DIFFERENT_WORKER");
  if (matchingDomains.length > 1) throw new Error("STATUS_HOSTNAME_HAS_DUPLICATE_WORKER_DOMAINS");
  if (matchingDomains.length === 0 && Array.isArray(dnsRecords) && dnsRecords.length > 0) {
    throw new Error("STATUS_HOSTNAME_DNS_CONFLICT");
  }

  const action = matchingDomains.length === 1 ? "UPDATE_EXISTING_WORKER" : "CREATE_WORKER_AND_CUSTOM_DOMAIN";
  const plan = {
    generatedAt: new Date().toISOString(),
    mode: "dry-run",
    hostname,
    serviceName,
    authorization: {
      tokenActive: true,
      accountReachable: true,
      zoneActive: true,
    },
    current: {
      matchingCustomDomainCount: matchingDomains.length,
      conflictingDnsRecordCount: matchingDomains.length === 0 ? dnsRecords.length : 0,
    },
    plannedAction: action,
    rollback: action === "CREATE_WORKER_AND_CUSTOM_DOMAIN"
      ? [
          "Detach status.qidaigo.com from stallorder-status.",
          "Delete the stallorder-status Worker only after the hostname is detached.",
          "Review and remove the now-unused generated certificate separately if required.",
        ]
      : [
          "Redeploy the previously verified stallorder-status Worker version.",
          "Keep the existing custom domain attached during code rollback.",
        ],
  };
  await mkdir(resolve("artifacts"), { recursive: true });
  await writeFile(
    resolve("artifacts/status-page-deployment-plan.json"),
    `${JSON.stringify(plan, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify({
    event: "status_page_deployment_planned",
    hostname,
    action,
    tokenActive: true,
    zoneActive: true,
    dnsConflict: false,
    planPath: "artifacts/status-page-deployment-plan.json",
  }));
} catch (error) {
  console.error(JSON.stringify({
    event: "status_page_deployment_plan_failed",
    reason: safeReason(error),
  }));
  process.exitCode = 1;
}

async function verifyToken() {
  const paths = [
    `/accounts/${accountId}/tokens/verify`,
    "/user/tokens/verify",
  ];
  let lastError;

  for (const path of paths) {
    try {
      return await cloudflare(path);
    } catch (error) {
      lastError = error;
      if (!isTokenEndpointCompatibilityError(error)) throw error;
    }
  }

  throw lastError ?? new Error("CLOUDFLARE_TOKEN_VERIFICATION_FAILED");
}

async function cloudflare(path) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) {
    const error = new Error(`CLOUDFLARE_API_${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload.result;
}

function isTokenEndpointCompatibilityError(error) {
  return error instanceof Error && [400, 401, 403, 404].includes(error.status);
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_MISSING`);
  return value;
}

function identifier(name) {
  const value = required(name);
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(value)) throw new Error(`${name}_INVALID`);
  return value;
}

function safeReason(error) {
  const message = error instanceof Error ? error.message : "UNKNOWN";
  return /^[A-Z0-9_]+$/.test(message) ? message : "STATUS_PAGE_PLAN_FAILED";
}
