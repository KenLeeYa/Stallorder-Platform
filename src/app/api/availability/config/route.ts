import { NextResponse } from "next/server";
import { createRequestId } from "@/lib/security";
import { getAvailabilityConfig } from "@/server/resilience/availability-config-service";

export async function GET() {
  const requestId = createRequestId();
  const config = await getAvailabilityConfig(requestId);

  return NextResponse.json(
    config,
    {
      headers: {
        "cache-control": "public, max-age=0, s-maxage=2, stale-while-revalidate=2",
        "x-request-id": requestId,
      },
    },
  );
}
