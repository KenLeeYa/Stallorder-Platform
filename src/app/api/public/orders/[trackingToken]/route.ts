import { createRequestId } from "@/lib/security";
import { getPublicOrderOperationId } from "@/lib/public-order-operation-id";
import { readJson } from "@/lib/http";
import {
  cancelTrackedPublicOrderSchema,
  updateTrackedPublicOrderSchema,
} from "@/lib/public-order-edit-contract";
import { createPerformanceTiming } from "@/lib/performance-timing";
import {
  assertCircuitBRequest,
  circuitBFailureResponse,
  circuitBResponse,
  finalizeCircuitBResponse,
  requireCircuitBClientIp,
} from "@/server/public-order/circuit-b-http";
import {
  cancelOrderThroughCircuitB,
  editOrderThroughCircuitB,
  getOrderThroughCircuitB,
} from "@/server/public-order/circuit-b-service";
import { getPublicOrderSchema } from "../../../../../../supabase/functions/_shared/schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ trackingToken: string }> },
) {
  const requestId = createRequestId();
  const operationId = getPublicOrderOperationId(request);
  const timing = createPerformanceTiming({
    route: "/api/public/orders/:trackingToken",
    requestId,
    operationId,
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
        operationId,
      );
    }

    const result = await getOrderThroughCircuitB(parsed.data, {
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
      "PUBLIC_ORDER_TRACKING_CIRCUIT_B_FAILED",
      operationId,
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ trackingToken: string }> },
) {
  const requestId = createRequestId();
  const operationId = getPublicOrderOperationId(request);
  const timing = createPerformanceTiming({
    route: "/api/public/orders/:trackingToken",
    requestId,
    operationId,
  });

  try {
    assertCircuitBRequest(request);
    const clientIp = requireCircuitBClientIp(request);
    const body = await readJson(request, requestId);
    if (body.error) return finalizeCircuitBResponse(body.error, requestId, timing, operationId);
    const { trackingToken } = await params;
    const command = updateTrackedPublicOrderSchema.safeParse(body.data);
    const identity = getPublicOrderSchema.safeParse({
      trackingToken,
      deviceId: command.success ? command.data.deviceId : null,
    });
    if (!command.success || !identity.success) {
      return circuitBResponse(
        { error: "訂單修改資料不正確。", code: "INVALID_REQUEST" },
        400,
        requestId,
        timing,
        operationId,
      );
    }

    const result = await editOrderThroughCircuitB(
      { ...command.data, trackingToken: identity.data.trackingToken },
      { clientIp, requestId, timing },
    );
    return circuitBResponse(result.body, result.status, requestId, timing, operationId);
  } catch (error) {
    return circuitBFailureResponse(
      error,
      requestId,
      timing,
      "PUBLIC_ORDER_EDIT_FAILED",
      operationId,
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ trackingToken: string }> },
) {
  const requestId = createRequestId();
  const operationId = getPublicOrderOperationId(request);
  const timing = createPerformanceTiming({
    route: "/api/public/orders/:trackingToken",
    requestId,
    operationId,
  });

  try {
    assertCircuitBRequest(request);
    const clientIp = requireCircuitBClientIp(request);
    const body = await readJson(request, requestId);
    if (body.error) return finalizeCircuitBResponse(body.error, requestId, timing, operationId);
    const { trackingToken } = await params;
    const command = cancelTrackedPublicOrderSchema.safeParse(body.data);
    const identity = getPublicOrderSchema.safeParse({
      trackingToken,
      deviceId: command.success ? command.data.deviceId : null,
    });
    if (!command.success || !identity.success) {
      return circuitBResponse(
        { error: "訂單取消資料不正確。", code: "INVALID_REQUEST" },
        400,
        requestId,
        timing,
        operationId,
      );
    }

    const result = await cancelOrderThroughCircuitB(
      { ...command.data, trackingToken: identity.data.trackingToken },
      { clientIp, requestId, timing },
    );
    return circuitBResponse(result.body, result.status, requestId, timing, operationId);
  } catch (error) {
    return circuitBFailureResponse(
      error,
      requestId,
      timing,
      "PUBLIC_ORDER_CANCEL_FAILED",
      operationId,
    );
  }
}
