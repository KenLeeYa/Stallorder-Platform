import { createRequestId } from "@/lib/security";
import { getRequestPrincipal } from "@/lib/auth";
import { getLinePlatformRuntime } from "@/server/line-platform/runtime";
import { bindPlatformOrderSession } from "@/server/line-platform/guest-cart";
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
import { issueOrderSessionThroughCircuitB, PublicOrderCircuitError } from "@/server/public-order/circuit-b-service";
import { issueOrderSessionSchema } from "../../../../../supabase/functions/_shared/schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = createRequestId();
  const operationId = getPublicOrderOperationId(request);
  const timing = createPerformanceTiming({
    route: "/api/public/order-session",
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
    const parsed = issueOrderSessionSchema.safeParse(body.data);
    if (!parsed.success) {
      return circuitBResponse(
        { error: "訂單資料不正確。", code: "INVALID_REQUEST" },
        400,
        requestId,
        timing,
        operationId,
      );
    }

    const result = await issueOrderSessionThroughCircuitB(parsed.data, {
      clientIp,
      requestId,
      timing,
    });
    // Optional platform configuration must not interrupt the original public intake.
    let platformRuntime: ReturnType<typeof getLinePlatformRuntime> = null;
    try { platformRuntime = getLinePlatformRuntime(); } catch { /* Public fallback remains available. */ }
    if (platformRuntime && result.status < 300 && "orderSessionToken" in result.body && typeof result.body.orderSessionToken === "string") {
      try {
        await bindPlatformOrderSession({ orderSessionToken: result.body.orderSessionToken,
          deviceId: parsed.data.deviceId, qrToken: parsed.data.qrToken }, await getRequestPrincipal(request));
      } catch {
        throw new PublicOrderCircuitError("ORDER_SESSION_INVALID", 403);
      }
    }
    return circuitBResponse(result.body, result.status, requestId, timing, operationId);
  } catch (error) {
    return circuitBFailureResponse(
      error,
      requestId,
      timing,
      "ORDER_SESSION_CIRCUIT_B_FAILED",
      operationId,
    );
  }
}
