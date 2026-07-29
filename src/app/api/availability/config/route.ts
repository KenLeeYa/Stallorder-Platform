import { NextResponse } from "next/server";
import { z } from "zod";
import { createRequestId } from "@/lib/security";
import { getAvailabilityConfig } from "@/server/resilience/availability-config-service";

const deviceIdSchema = z.string().uuid();

export async function GET(request: Request) {
  const requestId = createRequestId();
  const requestedDeviceId = request.headers.get("x-stallorder-device-id");
  const parsedDeviceId = requestedDeviceId
    ? deviceIdSchema.safeParse(requestedDeviceId)
    : null;
  const config = await getAvailabilityConfig(requestId, {
    deviceId: parsedDeviceId?.success ? parsedDeviceId.data : undefined,
  });

  return NextResponse.json(
    config,
    {
      headers: {
        "cache-control": parsedDeviceId?.success
          ? "private, no-store"
          : "public, max-age=0, s-maxage=2, stale-while-revalidate=2",
        "x-request-id": requestId,
      },
    },
  );
}
