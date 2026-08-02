import { NextResponse } from "next/server";
import { entitlementErrorResponse } from "@/server/billing/entitlement-http";
import {
  StallScheduleOperationError,
  stallScheduleErrorMessage,
} from "@/lib/stall-schedules";

export function stallScheduleErrorResponse(error: unknown, requestId: string) {
  const entitlementResponse = entitlementErrorResponse(error, requestId);
  if (entitlementResponse) return entitlementResponse;
  if (!(error instanceof StallScheduleOperationError)) throw error;
  const status = error.code.endsWith("_NOT_FOUND")
    ? 404
    : error.code.endsWith("_REQUIRED") || error.code === "EVENT_FEATURE_REQUIRED"
      ? 403
      : 409;
  const message = stallScheduleErrorMessage(error);
  const fieldErrors = stallScheduleOperationFieldErrors(error.code, message);
  return NextResponse.json(
    { error: message, code: error.code, ...(fieldErrors ? { fieldErrors } : {}) },
    { status, headers: noStoreHeaders(requestId) },
  );
}

function stallScheduleOperationFieldErrors(
  code: StallScheduleOperationError["code"],
  message: string,
) {
  if (code === "SCHEDULE_CONTEXT_INVALID") {
    return { locationId: message, marketEventId: message };
  }
  if (code === "SCHEDULE_EVENT_WINDOW_INVALID") return { startsAt: message, endsAt: message };
  if (code === "QR_CODE_NOT_FOUND") return { qrCodeId: message };
  if (code === "QR_ORDER_TYPE_INVALID" || code === "DELIVERY_MODULE_REQUIRED") {
    return { fulfillmentType: message };
  }
  if (code === "AUTOMATIC_ORDERING_REQUIRED") {
    return { autoOpenEnabled: message, autoCloseEnabled: message };
  }
  return null;
}

export function requireJsonContentType(request: Request, requestId: string) {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() === "application/json") {
    return null;
  }
  return NextResponse.json(
    { error: "Content-Type 必須是 application/json。" },
    { status: 415, headers: noStoreHeaders(requestId) },
  );
}

export function noStoreHeaders(requestId: string) {
  return { "cache-control": "private, no-store", "x-request-id": requestId };
}
