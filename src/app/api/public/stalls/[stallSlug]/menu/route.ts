import { NextResponse } from "next/server";
import { z } from "zod";
import { createPerformanceTiming, finalizePerformanceResponse } from "@/lib/performance-timing";
import { privateNoStoreHeaders, publicMenuResponseHeaders } from "@/lib/public-cache-policy";
import { getCachedPublicMenuForStallSlug } from "@/lib/public-menu";
import { createRequestId } from "@/lib/security";

const stallSlugSchema = z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

type RouteContext = { params: Promise<{ stallSlug: string }> };

export async function GET(request: Request, context: RouteContext) {
  const requestId = createRequestId();
  const timing = createPerformanceTiming({
    route: "/api/public/stalls/:stallSlug/menu",
    requestId,
  });
  const { stallSlug } = await context.params;
  const parsed = stallSlugSchema.safeParse(stallSlug);
  if (!parsed.success) {
    return finalizePerformanceResponse(NextResponse.json(
      { error: "找不到公開菜單。" },
      { status: 404, headers: privateNoStoreHeaders() },
    ), timing);
  }

  const menu = await timing.measureDb(() => getCachedPublicMenuForStallSlug(parsed.data));
  if (!menu) {
    return finalizePerformanceResponse(NextResponse.json(
      { error: "找不到公開菜單。" },
      { status: 404, headers: privateNoStoreHeaders() },
    ), timing);
  }

  return finalizePerformanceResponse(NextResponse.json(
    { menu },
    { headers: publicMenuResponseHeaders(request) },
  ), timing);
}
