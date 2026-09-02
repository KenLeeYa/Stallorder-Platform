import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/authorization";
import { kitchenBoardQuerySchema } from "@/lib/kitchen-contract";
import { getKitchenBoardData } from "@/lib/kitchen";
import { createPerformanceTiming, finalizePerformanceResponse } from "@/lib/performance-timing";
import { createRequestId } from "@/lib/security";

type RouteContext = { params: Promise<{ stallSlug: string }> };

export async function GET(request: Request, context: RouteContext) {
  const requestId = createRequestId();
  const timing = createPerformanceTiming({
    route: "/api/stalls/:stallSlug/kitchen/board",
    requestId,
  });
  const finalize = <T extends Response>(response: T) => finalizePerformanceResponse(response, timing);
  const { stallSlug } = await context.params;
  const authorization = await timing.measure(
    "authMs",
    () => timing.measureDb(
      () => authorizeApiRequest(request, stallSlug, "VIEW_KDS", requestId),
      4,
    ),
  );
  if (!authorization.ok) return finalize(authorization.response);

  const stationId = new URL(request.url).searchParams.get("stationId") ?? undefined;
  const query = kitchenBoardQuerySchema.safeParse({ stationId });
  if (!query.success) {
    return finalize(NextResponse.json(
      { error: "\u5de5\u4f5c\u7ad9\u7be9\u9078\u689d\u4ef6\u4e0d\u6b63\u78ba\u3002" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    ));
  }

  const data = await timing.measureDb(
    () => getKitchenBoardData(
      authorization.stall.organizationId,
      authorization.stall.id,
      query.data.stationId,
    ),
    5,
  );
  return finalize(NextResponse.json(data, {
    headers: { "cache-control": "no-store", "x-request-id": authorization.requestId },
  }));
}
