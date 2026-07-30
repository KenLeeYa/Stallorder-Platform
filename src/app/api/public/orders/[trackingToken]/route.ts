import { createRequestId } from "@/lib/security";
import { createPerformanceTiming } from "@/lib/performance-timing";
import {
  assertCircuitBRequest,
  circuitBFailureResponse,
  circuitBResponse,
  requireCircuitBClientIp,
} from "@/server/public-order/circuit-b-http";
import { getOrderThroughCircuitB } from "@/server/public-order/circuit-b-service";
import { getPublicOrderSchema } from "../../../../../../supabase/functions/_shared/schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ trackingToken: string }> },
) {
  const requestId = createRequestId();
  const timing = createPerformanceTiming({
    route: "/api/public/orders/:trackingToken",
    requestId,
  });

  try {
    assertCircuitBRequest(request);
    const clientIp = requireCircuitBClientIp(request);
    const { trackingToken } = await params;
    const parsed = getPublicOrderSchema.safeParse({
      trackingToken,
      deviceId: request.headers.get("x-stallorder-device-id"),
    });
    if (!parsed.success) {
      return circuitBResponse(
        { error: "訂單資料不正確。", code: "INVALID_REQUEST" },
        400,
        requestId,
        timing,
      );
    }

    const result = await getOrderThroughCircuitB(parsed.data, {
      clientIp,
      requestId,
      timing,
    });
    return circuitBResponse(result.body, result.status, requestId, timing);
  } catch (error) {
    return circuitBFailureResponse(
      error,
      requestId,
      timing,
      "PUBLIC_ORDER_TRACKING_CIRCUIT_B_FAILED",
    );
  }
}
