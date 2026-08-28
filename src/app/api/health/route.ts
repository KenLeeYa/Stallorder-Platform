import { NextResponse } from "next/server";
import { logEvent } from "@/lib/audit";
import { inspectDirectDatabaseConnection, inspectRuntimeDatabaseConnection } from "@/lib/database-connection-profile";
import { createPerformanceTiming, finalizePerformanceResponse } from "@/lib/performance-timing";
import { createRequestId } from "@/lib/security";
import { checkPrimaryDatabaseHealth } from "@/server/resilience/health-service";

let connectionProfileLogged = false;

export async function GET() {
  const requestId = createRequestId();
  const timing = createPerformanceTiming({ route: "/api/health", requestId });
  const runtimeConnection = inspectRuntimeDatabaseConnection();
  const directConnection = inspectDirectDatabaseConnection();
  if (!connectionProfileLogged) {
    connectionProfileLogged = true;
    logEvent("info", "DATABASE_CONNECTION_PROFILE", {
      requestId,
      runtimeConfigured: runtimeConnection.configured,
      runtimeValid: runtimeConnection.validPostgresUrl,
      runtimeSupavisor: runtimeConnection.usesSupavisor,
      runtimeTransactionPort: runtimeConnection.usesTransactionPort,
      runtimePgbouncerMode: runtimeConnection.disablesPreparedStatements,
      runtimeConnectionLimitConfigured: runtimeConnection.hasConnectionLimit,
      directConfigured: directConnection.configured,
      directValid: directConnection.validPostgresUrl,
      directMigrationPort: directConnection.usesMigrationPort,
    });
  }
  const health = await timing.measureDb(checkPrimaryDatabaseHealth);
  const available = health.status === "HEALTHY" || health.status === "DEGRADED";
  if (!available) {
    logEvent("error", "HEALTH_CHECK_FAILED", { requestId });
  }

  return finalizePerformanceResponse(NextResponse.json(
    {
      status: available ? "ok" : "unavailable",
      health: health.status,
      timestamp: health.checkedAt,
    },
    {
      status: available ? 200 : 503,
      headers: { "cache-control": "no-store", "x-request-id": requestId },
    },
  ), timing);
}
