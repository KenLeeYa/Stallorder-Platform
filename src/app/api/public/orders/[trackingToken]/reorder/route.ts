import { readJson } from "@/lib/http";
import { createPerformanceTiming } from "@/lib/performance-timing";
import { getPublicOrderOperationId } from "@/lib/public-order-operation-id";
import { createRequestId } from "@/lib/security";
import {
  assertCircuitBRequest,
  circuitBFailureResponse,
  circuitBResponse,
  finalizeCircuitBResponse,
  requireCircuitBClientIp,
} from "@/server/public-order/circuit-b-http";
import { prepareReorderThroughCircuitB } from "@/server/public-order/circuit-b-service";
import { prepareReorderSchema } from "../../../../../../../supabase/functions/_shared/schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ trackingToken: string }> },
) {
  const requestId = createRequestId();
  const operationId = getPublicOrderOperationId(request);
  const timing = createPerformanceTiming({
    route: "/api/public/orders/:trackingToken/reorder",
    requestId,
    operationId,
  });

  try {
    assertCircuitBRequest(request);
    const clientIp = requireCircuitBClientIp(request);
    const body = await readJson(request, requestId);
    if (body.error) return finalizeCircuitBResponse(body.error, requestId, timing, operationId);
    const { trackingToken } = await params;
    const command = prepareReorderSchema.safeParse({
      ...(body.data && typeof body.data === "object" ? body.data : {}),
      trackingToken,
    });
    if (!command.success) {
      return circuitBResponse(
        { error: "訂單修改資料不正確。", code: "INVALID_REQUEST" },
        400,
        requestId,
        timing,
        operationId,
      );
    }

    const result = await prepareReorderThroughCircuitB(command.data, {
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
      "PUBLIC_ORDER_PREPARE_REORDER_FAILED",
      operationId,
    );
  }
}
