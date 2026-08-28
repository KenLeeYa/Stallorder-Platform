import { NextResponse } from "next/server";
import { logEvent } from "@/lib/audit";
import { createRequestId } from "@/lib/security";
import { checkPrimaryDatabaseHealth } from "@/server/resilience/health-service";

export async function GET() {
  const requestId = createRequestId();
  const health = await checkPrimaryDatabaseHealth();
  const available = health.status === "HEALTHY" || health.status === "DEGRADED";

  if (!available || health.status === "DEGRADED") {
    logEvent(available ? "warn" : "error", "PRIMARY_HEALTH_CHECK_COMPLETED", {
      requestId,
      status: health.status,
      latencyMs: health.latencyMs,
    });
  }

  return NextResponse.json(
    {
      status: health.status,
      checkedAt: health.checkedAt,
    },
    {
      status: available ? 200 : 503,
      headers: {
        "cache-control": "no-store",
        "x-request-id": requestId,
      },
    },
  );
}
