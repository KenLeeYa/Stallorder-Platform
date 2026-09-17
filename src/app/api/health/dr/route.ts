import { NextResponse } from "next/server";
import { logEvent } from "@/lib/audit";
import { createRequestId } from "@/lib/security";
import { checkDrDatabaseHealth } from "@/server/resilience/health-service";
import { authorizeHealthApiRequest } from "@/server/resilience/health-authorization";

export async function GET(request: Request) {
  const authorization = await authorizeHealthApiRequest(request);
  if (!authorization.ok) return authorization.response;
  const requestId = createRequestId();
  const health = await checkDrDatabaseHealth();
  const unavailable = health.status === "UNAVAILABLE";

  if (unavailable || health.status === "DEGRADED") {
    logEvent("warn", "DR_HEALTH_CHECK_COMPLETED", {
      requestId,
      status: health.status,
      latencyMs: health.latencyMs,
      reasonCode: health.reasonCode,
    });
  }

  return NextResponse.json(
    {
      status: health.status,
      checkedAt: health.checkedAt,
    },
    {
      status: unavailable ? 503 : 200,
      headers: {
        "cache-control": "no-store",
        "x-request-id": requestId,
      },
    },
  );
}
