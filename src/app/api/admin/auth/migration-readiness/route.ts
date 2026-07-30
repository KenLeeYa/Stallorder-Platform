import { NextResponse } from "next/server";
import { authorizePlatformAdminApiRequest } from "@/lib/authorization";
import { getOAuthMigrationReadiness } from "@/server/auth/oauth/migration-readiness";

export async function GET(request: Request) {
  const authorization = await authorizePlatformAdminApiRequest(request);
  if (!authorization.ok) return authorization.response;
  return NextResponse.json(
    { readiness: await getOAuthMigrationReadiness() },
    {
      headers: {
        "cache-control": "no-store",
        "x-request-id": authorization.requestId,
      },
    },
  );
}
