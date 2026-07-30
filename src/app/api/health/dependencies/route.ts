import { NextResponse } from "next/server";
import { authorizePlatformAdminApiRequest } from "@/lib/authorization";
import { logEvent } from "@/lib/audit";
import { getDependencyHealthSnapshot } from "@/server/resilience/health-service";

export async function GET(request: Request) {
  const authorization = await authorizePlatformAdminApiRequest(request);
  if (!authorization.ok) return authorization.response;

  const snapshot = await getDependencyHealthSnapshot();
  logEvent(snapshot.status === "UNAVAILABLE" ? "error" : "info", "DEPENDENCY_HEALTH_CHECK_COMPLETED", {
    requestId: authorization.requestId,
    status: snapshot.status,
  });

  return NextResponse.json(
    snapshot,
    {
      status: snapshot.status === "UNAVAILABLE" ? 503 : 200,
      headers: {
        "cache-control": "no-store",
        "x-request-id": authorization.requestId,
      },
    },
  );
}
