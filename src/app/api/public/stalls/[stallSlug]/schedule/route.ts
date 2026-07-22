import { NextResponse } from "next/server";
import { z } from "zod";
import { createRequestId } from "@/lib/security";
import { getPublicStallSchedule } from "@/lib/stall-schedules";

const stallSlugSchema = z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
type RouteContext = { params: Promise<{ stallSlug: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const requestId = createRequestId();
  const { stallSlug } = await context.params;
  const parsed = stallSlugSchema.safeParse(stallSlug);
  if (!parsed.success) return notFoundResponse(requestId);
  const data = await getPublicStallSchedule(parsed.data);
  if (!data) return notFoundResponse(requestId);
  return NextResponse.json(data, {
    headers: {
      "cache-control": "public, max-age=15, s-maxage=30, stale-while-revalidate=30",
      "x-content-type-options": "nosniff",
      "x-request-id": requestId,
    },
  });
}

function notFoundResponse(requestId: string) {
  return NextResponse.json(
    { error: "找不到公開出攤行程。" },
    {
      status: 404,
      headers: {
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "x-request-id": requestId,
      },
    },
  );
}
