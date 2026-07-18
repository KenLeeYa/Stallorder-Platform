import { NextResponse } from "next/server";
import { logEvent } from "@/lib/audit";
import { createPerformanceTiming, finalizePerformanceResponse } from "@/lib/performance-timing";
import { prisma } from "@/lib/prisma";
import { createRequestId } from "@/lib/security";
import { inspectDirectDatabaseConnection, inspectRuntimeDatabaseConnection } from "@/lib/database-connection-profile";

export async function GET() {
  const requestId = createRequestId();
  const timing = createPerformanceTiming({ route: "/api/health", requestId });
  const runtimeConnection = inspectRuntimeDatabaseConnection();
  const directConnection = inspectDirectDatabaseConnection();
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
  try {
    await timing.measure("dbMs", () => prisma.$queryRaw`SELECT 1`);
    return finalizePerformanceResponse(NextResponse.json(
      { status: "ok", timestamp: new Date().toISOString() },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    ), timing);
  } catch {
    logEvent("error", "HEALTH_CHECK_FAILED", { requestId });
    return finalizePerformanceResponse(NextResponse.json(
      { status: "unavailable", timestamp: new Date().toISOString() },
      { status: 503, headers: { "cache-control": "no-store", "x-request-id": requestId } },
    ), timing);
  }
}
