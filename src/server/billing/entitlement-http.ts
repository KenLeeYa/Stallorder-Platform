import "server-only";

import { NextResponse } from "next/server";
import { entitlementErrorFromUnknown, entitlementErrorPayload } from "@/server/billing/entitlement-service";

export function entitlementErrorResponse(error: unknown, requestId: string) {
  const entitlementError = entitlementErrorFromUnknown(error);
  if (!entitlementError) return null;
  const payload = entitlementErrorPayload(entitlementError);
  return NextResponse.json(
    { error: payload.error, code: payload.code },
    { status: payload.status, headers: { "x-request-id": requestId } },
  );
}
