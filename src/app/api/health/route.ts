import { NextResponse } from "next/server";
import { logEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { createRequestId } from "@/lib/security";

export async function GET() {
  const requestId = createRequestId();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(
      { status: "ok", timestamp: new Date().toISOString() },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch {
    logEvent("error", "HEALTH_CHECK_FAILED", { requestId });
    return NextResponse.json(
      { status: "unavailable", timestamp: new Date().toISOString() },
      { status: 503, headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  }
}
