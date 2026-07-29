import { NextResponse } from "next/server";
import { logEvent } from "@/lib/audit";
import { createRequestId } from "@/lib/security";
import { checkDrDatabaseHealth } from "@/server/resilience/health-service";

export async function GET() {
  const requestId = createRequestId();
  const health = await checkDrDatabaseHealth();
  const unavailable = health.status === "UNAVAILABLE";

  logEvent(unavailable ? "warn" : "info", "DR_HEALTH_CHECK_COMPLETED", {
    requestId,
    status: health.status,
    latencyMs: health.latencyMs,
    reasonCode: health.reasonCode,
  });

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
