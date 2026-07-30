import { NextResponse } from "next/server";
import { authorizePlatformAdminApiRequest } from "@/lib/authorization";
import { listResilienceFeatureFlagsForAdmin } from "@/server/resilience/feature-flag-service";

export async function GET(request: Request) {
  const authorization = await authorizePlatformAdminApiRequest(request);
  if (!authorization.ok) return authorization.response;

  const flags = await listResilienceFeatureFlagsForAdmin();
  return NextResponse.json(
    { flags },
    {
      headers: {
        "cache-control": "no-store",
        "x-request-id": authorization.requestId,
      },
    },
  );
}
