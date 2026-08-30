import { z } from "zod";
import { createRequestId } from "@/lib/security";
import { getPublicOrderOperationId } from "@/lib/public-order-operation-id";
import { readJson } from "@/lib/http";
import { createPerformanceTiming } from "@/lib/performance-timing";
import { invoiceBuyerSelectionSchema } from "@/server/e-invoice/e-invoice-contract";
import {
  assertCircuitBRequest,
  circuitBFailureResponse,
  circuitBResponse,
  finalizeCircuitBResponse,
  requireCircuitBClientIp,
} from "@/server/public-order/circuit-b-http";
import { saveInvoicePreferenceThroughCircuitB } from "@/server/public-order/circuit-b-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestSchema = z.object({
  deviceId: z.string().uuid(),
  buyer: invoiceBuyerSelectionSchema,
}).strict();

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ trackingToken: string }> },
) {
  const requestId = createRequestId();
  const operationId = getPublicOrderOperationId(request);
  const timing = createPerformanceTiming({
    route: "/api/public/orders/:trackingToken/invoice-preference",
    requestId,
    operationId,
  });
  try {
    assertCircuitBRequest(request);
    const clientIp = requireCircuitBClientIp(request);
    const body = await readJson(request, requestId);
    if (body.error) return finalizeCircuitBResponse(body.error, requestId, timing, operationId);
    const parsed = requestSchema.safeParse(body.data);
    const { trackingToken } = await params;
    if (!parsed.success || trackingToken.length < 40 || trackingToken.length > 200) {
      return circuitBResponse(
        { error: "電子發票資料不正確。", code: "INVALID_REQUEST" },
        400,
        requestId,
        timing,
        operationId,
      );
    }
    const result = await saveInvoicePreferenceThroughCircuitB(
      { trackingToken, ...parsed.data },
      { clientIp, requestId, timing },
    );
    return circuitBResponse(result.body, result.status, requestId, timing, operationId);
  } catch (error) {
    return circuitBFailureResponse(
      error,
      requestId,
      timing,
      "PUBLIC_ORDER_INVOICE_PREFERENCE_FAILED",
      operationId,
    );
  }
}
