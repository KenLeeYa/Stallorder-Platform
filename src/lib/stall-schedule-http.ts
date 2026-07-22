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
  return NextResponse.json(
    { error: stallScheduleErrorMessage(error), code: error.code },
    { status, headers: noStoreHeaders(requestId) },
  );
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
