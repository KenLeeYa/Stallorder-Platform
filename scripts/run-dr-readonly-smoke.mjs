import { performance } from "node:perf_hooks";
import { PrismaClient } from "@prisma/client";

const target = required("EXPECTED_BACKEND").toUpperCase();
const expectedEpoch = Number.parseInt(required("EXPECTED_PROMOTION_EPOCH"), 10);
const baseUrl = new URL(required("APP_BASE_URL"));
const expectedProjectRef = target === "DR"
  ? required("DR_SUPABASE_PROJECT_REF")
  : required("PRIMARY_SUPABASE_PROJECT_REF");
if (!["PRIMARY", "DR"].includes(target)) throw new Error("EXPECTED_BACKEND_INVALID");
if (!Number.isSafeInteger(expectedEpoch) || expectedEpoch < 1) {
  throw new Error("EXPECTED_PROMOTION_EPOCH_INVALID");
}
if (baseUrl.protocol !== "https:") throw new Error("APP_BASE_URL_INVALID");

const database = new PrismaClient({
  datasources: {
    db: {
      url: requiredPostgresUrl(target === "DR" ? "DR_DIRECT_URL" : "DIRECT_URL"),
    },
  },
});

try {
  const qrRows = await database.$queryRawUnsafe(
    `select token
     from public.qr_codes
     where status = 'ACTIVE'
       and (expires_at is null or expires_at > now())
     order by created_at
     limit 1`,
  );
  if (!qrRows[0]?.token) throw new Error("ACTIVE_QR_NOT_FOUND");
  const routes = [
    { label: "homepage", path: "/" },
    { label: "login", path: "/login" },
    { label: "health", path: "/api/health" },
    { label: "availability", path: "/api/availability/config" },
    { label: "qr_menu", path: `/q/${encodeURIComponent(qrRows[0].token)}` },
  ];
  const results = [];
  for (const route of routes) {
    const startedAt = performance.now();
    const response = await fetch(new URL(route.path, baseUrl), {
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
      headers: { accept: route.label.includes("health") || route.label === "availability"
        ? "application/json"
        : "text/html" },
    });
    const totalMs = Math.round(performance.now() - startedAt);
    if (!response.ok) throw new Error(`SMOKE_${route.label.toUpperCase()}_${response.status}`);
    if (route.label === "availability") {
      const availability = await response.json();
      if (
        availability.activeBackend !== target
        || availability.promotionEpoch !== expectedEpoch
        || availability.mode !== (target === "DR" ? "NORMAL_DR" : "NORMAL_PRIMARY")
      ) {
        throw new Error("SMOKE_AVAILABILITY_MISMATCH");
      }
    } else {
      await response.arrayBuffer();
    }
    results.push({ route: route.label, status: response.status, totalMs });
  }

  if (process.env.SKIP_OAUTH_WRITE !== "true") {
    const oauthStartedAt = performance.now();
    const oauth = await fetch(new URL("/auth/google", baseUrl), {
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
    const location = oauth.headers.get("location");
    if (!location || ![302, 303, 307, 308].includes(oauth.status)) {
      throw new Error("SMOKE_GOOGLE_OAUTH_REDIRECT_MISSING");
    }
    const oauthHost = new URL(location).hostname;
    if (!oauthHost.includes(expectedProjectRef)) {
      throw new Error("SMOKE_GOOGLE_OAUTH_PROJECT_MISMATCH");
    }
    results.push({
      route: "google_oauth_start",
      status: oauth.status,
      totalMs: Math.round(performance.now() - oauthStartedAt),
      authProjectMatched: true,
    });
  }

  console.log(JSON.stringify({
    event: "dr_readonly_smoke_completed",
    target,
    promotionEpoch: expectedEpoch,
    oauthWriteSkipped: process.env.SKIP_OAUTH_WRITE === "true",
    results,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    event: "dr_readonly_smoke_failed",
    target,
    reason: error instanceof Error ? error.message : "UNKNOWN",
  }));
  process.exitCode = 1;
} finally {
  await database.$disconnect();
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_MISSING`);
  return value;
}

function requiredPostgresUrl(name) {
  const value = required(name);
  const parsed = new URL(value);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error(`${name}_INVALID`);
  }
  return value;
}
