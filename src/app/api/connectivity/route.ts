import { checkPrimaryDatabaseHealth } from "@/server/resilience/health-service";

export const dynamic = "force-dynamic";

// Public reachability only. Never return dependency, backend, identity or version data.
export async function GET() {
  const health = await checkPrimaryDatabaseHealth();
  return new Response(null, {
    status: health.status === "HEALTHY" || health.status === "DEGRADED" ? 200 : 503,
    headers: {
      "cache-control": "no-store", "x-robots-tag": "noindex, nofollow",
      "x-service-state": health.status === "HEALTHY" ? "ready" : health.status === "DEGRADED" ? "degraded" : "unavailable",
    },
  });
}

export const HEAD = GET;
