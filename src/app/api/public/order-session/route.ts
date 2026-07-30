import { createRequestId } from "@/lib/security";
import { readJson } from "@/lib/http";
import { createPerformanceTiming } from "@/lib/performance-timing";
import {
  assertCircuitBRequest,
  circuitBFailureResponse,
  circuitBResponse,
  finalizeCircuitBResponse,
  requireCircuitBClientIp,
} from "@/server/public-order/circuit-b-http";
import { issueOrderSessionThroughCircuitB } from "@/server/public-order/circuit-b-service";
import { issueOrderSessionSchema } from "../../../../../supabase/functions/_shared/schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = createRequestId();
  const timing = createPerformanceTiming({
    route: "/api/public/order-session",
    requestId,
  });

  try {
    assertCircuitBRequest(request);
    const clientIp = requireCircuitBClientIp(request);
    const body = await readJson(request, requestId);
    if (body.error) {
      return finalizeCircuitBResponse(body.error, requestId, timing);
    }
    const parsed = issueOrderSessionSchema.safeParse(body.data);
    if (!parsed.success) {
      return circuitBResponse(
        { error: "訂單資料不正確。", code: "INVALID_REQUEST" },
        400,
        requestId,
        timing,
      );
    }

    const result = await issueOrderSessionThroughCircuitB(parsed.data, {
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
      "ORDER_SESSION_CIRCUIT_B_FAILED",
    );
  }
}
