import { createRequestId } from "@/lib/security";
import { getPublicOrderOperationId } from "@/lib/public-order-operation-id";
import { readJson } from "@/lib/http";
import { createPerformanceTiming } from "@/lib/performance-timing";
import {
  assertCircuitBRequest,
  circuitBFailureResponse,
  circuitBResponse,
  finalizeCircuitBResponse,
  requireCircuitBClientIp,
} from "@/server/public-order/circuit-b-http";
import { createOrderThroughCircuitB } from "@/server/public-order/circuit-b-service";
import { createPublicOrderSchema } from "../../../../../supabase/functions/_shared/schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = createRequestId();
  const operationId = getPublicOrderOperationId(request);
  const timing = createPerformanceTiming({
    route: "/api/public/orders",
    requestId,
    operationId,
  });

  try {
    assertCircuitBRequest(request);
    const clientIp = requireCircuitBClientIp(request);
    const body = await readJson(request, requestId);
    if (body.error) {
      return finalizeCircuitBResponse(body.error, requestId, timing, operationId);
    }
    const parsed = createPublicOrderSchema.safeParse(body.data);
    if (!parsed.success) {
      return circuitBResponse(
        { error: "訂單資料不正確。", code: "INVALID_REQUEST" },
        400,
        requestId,
        timing,
        operationId,
      );
    }

    const result = await createOrderThroughCircuitB(parsed.data, {
      clientIp,
      requestId,
      timing,
    });
    return circuitBResponse(result.body, result.status, requestId, timing, operationId);
  } catch (error) {
    return circuitBFailureResponse(
      error,
      requestId,
      timing,
      "PUBLIC_ORDER_CIRCUIT_B_FAILED",
      operationId,
    );
  }
}
