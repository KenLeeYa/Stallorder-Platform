import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const origin = new URL(process.env.HEALTH_QA_BASE_URL ?? "http://127.0.0.1:3026");
if (origin.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(origin.hostname)) {
  throw new Error("HEALTH_QA_LOCAL_ONLY");
}
const results = [];
async function check(label, path, allowedStatuses, headers = {}, options = {}) {
  const response = await fetch(new URL(path, origin), {
    redirect: "manual", headers: { accept: "application/json", ...headers },
    signal: AbortSignal.timeout(30_000), ...options,
  });
  const body = await response.text();
  assert.ok(allowedStatuses.includes(response.status), `${label}: HTTP ${response.status}`);
  results.push({ label, status: response.status, passed: true });
  return { response, body };
}
const healthPaths = ["/api/health", "/api/health/", "/api/health/primary", "/api/health/dr", "/api/health/dependencies"];
for (const path of healthPaths.filter((value) => !value.endsWith("/"))) {
  await check("anonymous " + path, path, [401]);
  await check("forged identity " + path, path, [401], { "cf-access-authenticated-user-email": "admin@example.test", "x-user-role": "PLATFORM_ADMIN" });
}
const trailing = await check("canonical trailing slash", "/api/health/", [308]);
assert.equal(new URL(trailing.response.headers.get("location"), origin).pathname, "/api/health");
for (const path of [
  "/api/admin/resilience/feature-flags",
  "/api/merchant/dashboard/overview?organizationId=11111111-1111-4111-8111-111111111111&dateFrom=2026-09-16&dateTo=2026-09-16",
  "/api/stalls/aming-chicken/orders",
  "/api/stalls/aming-chicken/kitchen/board",
  "/api/cron/staff-push",
]) await check("anonymous restricted " + path, path, [401, 403]);
await check("anonymous offline bootstrap", "/api/offline/bootstrap", [401, 403], { "x-stall-slug": "aming-chicken" }, { method: "POST" });
await check("anonymous shared catalog", "/api/merchant/organizations/11111111-1111-4111-8111-111111111111/catalog", [401, 403], {}, { method: "POST" });
await check("mock provider inactive", "/api/auth/mock/authorize", [404]);
await check("DR endpoint absent on Primary", "/api/health/dr/operator", [404]);
await check("DR dashboard absent on Primary", "/operator/health", [404]);
const connectivity = await check("public reachability", "/api/connectivity", [200]);
assert.equal(connectivity.body, "");
assert.ok(["ready", "degraded"].includes(connectivity.response.headers.get("x-service-state")));
const redirect = await check("browser opens protected dashboard", "/api/health", [307], { accept: "text/html" });
assert.equal(new URL(redirect.response.headers.get("location")).pathname, "/admin/health");

for (const role of ["owner", "staff", "kitchen", "platform.admin"]) {
  const response = await fetch(new URL("/api/auth/login", origin), {
    method: "POST", headers: { origin: origin.origin, "content-type": "application/json" },
    body: JSON.stringify({ email: role + "@stallorder.test", password: "StallOrderDemo!2026", next: "/admin/health" }),
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, 200, role + " fixture login");
  const jar = new Map(response.headers.getSetCookie().map((value) => {
    const pair = value.split(";")[0];
    const separator = pair.indexOf("=");
    return [pair.slice(0, separator), pair.slice(separator + 1)];
  }));
  const cookie = [...jar].map(([name, value]) => name + "=" + value).join("; ");
  const headers = { cookie };
  try {
    for (const path of healthPaths.filter((value) => !value.endsWith("/"))) {
      const result = await check(role + " " + path, path, [role === "platform.admin" ? 200 : 404], headers);
      assert.match(result.response.headers.get("cache-control") ?? "", /no-store/);
      if (role !== "platform.admin") assert.doesNotMatch(result.body, /dependencies|checkedAt|latencyMs|HEALTHY/);
    }
    const dashboard = await check(role + " dashboard", "/admin/health", role === "platform.admin" ? [200] : [200, 404], { ...headers, accept: "text/html" });
    if (role === "platform.admin") assert.match(dashboard.body, /正式站健康看板/);
    else assert.doesNotMatch(dashboard.body, /最後檢查：|primaryDatabase|各項服務檢查/);
    if (role !== "platform.admin") {
      await check(role + " non-member organization", "/api/merchant/organizations/99999999-9999-4999-8999-999999999999/catalog", [403, 404], headers, { method: "POST" });
      await check(role + " platform API", "/api/admin/resilience/feature-flags", [404], headers);
    }
  } finally {
    const logout = await fetch(new URL("/api/auth/logout", origin), {
      method: "POST", headers: { ...headers, origin: origin.origin, "x-csrf-token": decodeURIComponent(jar.get("stallorder_csrf") ?? "") },
      signal: AbortSignal.timeout(30_000),
    });
    assert.equal(logout.status, 200, role + " logout");
    await check(role + " revoked session", "/api/health", [401], headers);
  }
}
const report = { checkedAt: new Date().toISOString(), origin: origin.origin, cases: results.length, results };
if (process.env.HEALTH_QA_REPORT) await writeFile(process.env.HEALTH_QA_REPORT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
