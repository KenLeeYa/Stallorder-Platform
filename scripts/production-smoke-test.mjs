import {
  productionTestQrToken,
  resolveProductionTestQrUrl,
} from "./lib/production-smoke-qr-url.mjs";
import {
  isExpectedCanonicalRedirect,
  isExpectedPublicSiteResponse,
} from "./lib/production-smoke-public-site.mjs";
import { fetchWithTransientRetry } from "./lib/production-smoke-request.mjs";

const baseUrl = new URL(process.env.PRODUCTION_BASE_URL ?? "https://app.qidaigo.com");
const publicSiteUrl = process.env.ROOT_DOMAIN_URL ?? "https://qidaigo.com";
const wwwUrl = process.env.WWW_DOMAIN_URL ?? "https://www.qidaigo.com";
const allowHttp = process.env.SMOKE_ALLOW_HTTP === "true";
const skipDomainRedirects = process.env.SMOKE_SKIP_DOMAIN_REDIRECTS === "true";
const requireTestQr = process.env.PRODUCTION_TEST_QR_REQUIRED === "true";
const vercelAutomationBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
const requestHeaders = {
  "user-agent": "StallOrder-Production-Smoke/1.0",
  ...(vercelAutomationBypassSecret
    ? { "x-vercel-protection-bypass": vercelAutomationBypassSecret }
    : {}),
};
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
}

function assert(name, condition, detail) {
  record(name, Boolean(condition), detail);
}

async function request(label, url, options = {}) {
  return fetchWithTransientRetry({
    label,
    url,
    options: {
      method: options.method ?? "GET",
      redirect: options.redirect ?? "follow",
      headers: { ...requestHeaders, ...options.headers },
      body: options.body,
    },
  });
}

function containsDebugDetails(body) {
  return /PrismaClientKnownRequestError|postgres(?:ql)?:\/\/|DATABASE_URL|at\s+[^\n]+\([^\n]+:\d+:\d+\)/i.test(body);
}

async function checkCanonicalRedirect(name, source, canonical) {
  const response = await request(name, source, { redirect: "manual" });
  const location = response.headers.get("location");
  assert(
    name,
    isExpectedCanonicalRedirect({
      status: response.status,
      location,
      sourceUrl: source,
      canonicalUrl: canonical,
    }),
    `status=${response.status}, location=${location ?? "missing"}`,
  );
}

async function checkPublicSite(name, source) {
  const response = await request(name, source, { redirect: "manual" });
  const body = await response.text();
  assert(
    name,
    isExpectedPublicSiteResponse({
      status: response.status,
      contentType: response.headers.get("content-type"),
      body,
    }),
    `status=${response.status}, content-type=${response.headers.get("content-type") ?? "missing"}`,
  );
}

async function run() {
  assert(
    "HTTPS base URL",
    allowHttp || baseUrl.protocol === "https:",
    `base=${baseUrl.origin}`,
  );

  const mainResponse = await request("Main application", baseUrl);
  const mainBody = await mainResponse.text();
  assert("Main application loads", mainResponse.status === 200, `status=${mainResponse.status}`);
  assert("Main page hides stack traces", !containsDebugDetails(mainBody), "response body inspected");

  const requiredHeaders = [
    "content-security-policy",
    "x-content-type-options",
    "referrer-policy",
    "permissions-policy",
  ];
  for (const header of requiredHeaders) {
    assert(`Security header: ${header}`, Boolean(mainResponse.headers.get(header)), mainResponse.headers.get(header) ?? "missing");
  }
  const csp = mainResponse.headers.get("content-security-policy") ?? "";
  assert("CSP denies framing", /frame-ancestors\s+'none'/.test(csp), csp || "missing");
  assert("CSP allows Turnstile", csp.includes("https://challenges.cloudflare.com"), csp || "missing");
  assert("CSP avoids broad wildcard", !/(?:^|;|\s)\*(?:\s|;|$)/.test(csp), csp || "missing");
  if (baseUrl.protocol === "https:") {
    assert("HSTS enabled", Boolean(mainResponse.headers.get("strict-transport-security")), mainResponse.headers.get("strict-transport-security") ?? "missing");
  }

  const healthResponse = await request("Health endpoint", new URL("/api/health", baseUrl));
  const healthBody = await healthResponse.text();
  let healthPayload;
  try {
    healthPayload = JSON.parse(healthBody);
  } catch {
    healthPayload = null;
  }
  assert("Health endpoint is healthy", healthResponse.status === 200 && healthPayload?.status === "ok", `status=${healthResponse.status}`);
  assert("Health endpoint hides database details", !/database|postgres|connection|host|version|password/i.test(healthBody), healthBody.slice(0, 200));
  assert("Health endpoint hides stack traces", !containsDebugDetails(healthBody), "response body inspected");

  const invalidQrResponse = await request(
    "Invalid QR",
    new URL("/q/production-smoke-invalid-qr-token", baseUrl),
  );
  const invalidQrBody = await invalidQrResponse.text();
  assert("Invalid QR fails safely", invalidQrResponse.status < 500, `status=${invalidQrResponse.status}`);
  assert("Invalid QR hides stack traces", !containsDebugDetails(invalidQrBody), "response body inspected");

  const merchantApi = new URL("/api/merchant/dashboard/overview", baseUrl);
  merchantApi.searchParams.set("organizationId", "00000000-0000-4000-8000-000000000000");
  merchantApi.searchParams.set("dateFrom", "2026-01-01");
  merchantApi.searchParams.set("dateTo", "2026-01-01");
  const unauthorizedResponse = await request("Unauthenticated merchant API", merchantApi);
  assert(
    "Unauthenticated merchant API is denied",
    [401, 403].includes(unauthorizedResponse.status),
    `status=${unauthorizedResponse.status}`,
  );

  const assetMatch = mainBody.match(/(?:src|href)=["']([^"']*(?:_next\/static|\.css|\.js)[^"']*)["']/i);
  if (assetMatch) {
    const assetResponse = await request("Static asset", new URL(assetMatch[1], baseUrl));
    assert("Static asset loads", assetResponse.status === 200, `status=${assetResponse.status}, asset=${assetMatch[1]}`);
  } else {
    record("Static asset loads", false, "No static asset URL found in main HTML.");
  }

  if (!skipDomainRedirects) {
    await checkPublicSite("Root domain website loads", publicSiteUrl);
    await checkCanonicalRedirect("WWW domain redirects", wwwUrl, publicSiteUrl);
  } else {
    record("Root website and WWW redirect", true, "SKIPPED by SMOKE_SKIP_DOMAIN_REDIRECTS=true");
  }

  const testQrUrl = resolveProductionTestQrUrl({
    baseUrl,
    configuredUrl: process.env.PRODUCTION_TEST_QR_URL,
    required: requireTestQr,
  });
  if (testQrUrl) {
    const qrResponse = await request("Dedicated test QR page", testQrUrl);
    const qrBody = await qrResponse.text();
    assert("Dedicated test QR page loads", qrResponse.status === 200, `status=${qrResponse.status}`);
    assert("Dedicated test QR hides stack traces", !containsDebugDetails(qrBody), "response body inspected");

    const sessionResponse = await request(
      "Dedicated test QR session",
      new URL("/api/public-order/create-order-session", baseUrl),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-stallorder-protocol-version": "1",
        },
        body: JSON.stringify({
          qrToken: productionTestQrToken(testQrUrl),
          deviceId: crypto.randomUUID(),
          sessionRequestId: crypto.randomUUID(),
          orderingMode: "DEFAULT",
          includeMenu: false,
        }),
      },
    );
    const sessionBody = await sessionResponse.text();
    let sessionPayload;
    try {
      sessionPayload = JSON.parse(sessionBody);
    } catch {
      sessionPayload = null;
    }
    assert(
      "Dedicated test QR issues a secure order session",
      sessionResponse.status === 201
        && typeof sessionPayload?.orderSessionToken === "string"
        && sessionPayload.orderSessionToken.length >= 40,
      `status=${sessionResponse.status}, code=${typeof sessionPayload?.code === "string" ? sessionPayload.code : "missing"}`,
    );
    assert("Dedicated QR session hides stack traces", !containsDebugDetails(sessionBody), "response body inspected");
  } else {
    record("Dedicated Production QR checks", true, "SKIPPED: PRODUCTION_TEST_QR_URL is not configured; keep as a go-live blocker.");
  }

  for (const result of results) {
    console.log(`${result.ok ? "PASS" : "FAIL"}: ${result.name} - ${result.detail}`);
  }
  const failed = results.filter((result) => !result.ok);
  console.log(`Summary: ${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) process.exitCode = 1;
}

run().catch((error) => {
  console.error(`FAIL: smoke test aborted - ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
