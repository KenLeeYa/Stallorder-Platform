import { NextResponse } from "next/server";
import { ComplianceError } from "./access";

export function complianceJson(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: {
    "cache-control": "private, no-store, max-age=0", "cdn-cache-control": "no-store",
    "vercel-cdn-cache-control": "no-store", "referrer-policy": "no-referrer",
  } });
}
export function complianceFailure(error: unknown, requestId: string) {
  const known = error instanceof ComplianceError;
  return complianceJson({ error: "目前無法完成此操作，請保留案件編號並稍後再試。", code: known ? error.code : "COMPLIANCE_FAILED", requestId }, known ? error.status : 503);
}
