import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { PaymentProviderError } from "./types";
import type { SessionPrincipal } from "@/lib/auth";
import { requirePlatformOrderOwner } from "@/server/line-platform/member-service";
export const paymentHeaders = { "cache-control": "no-store", "referrer-policy": "no-referrer" };
export async function requirePaymentOrderOwner(principal: SessionPrincipal, orderId: string) {
  try { await requirePlatformOrderOwner(principal,orderId); }
  catch(error) {
    if(error instanceof Error && error.message==="LINE_PLATFORM_ORDER_NOT_FOUND") throw new PaymentProviderError("LINE_PAY_ORDER_NOT_FOUND",404);
    throw error;
  }
}
export function paymentError(error: unknown) {
  const status = error instanceof ZodError ? 400 : error instanceof PaymentProviderError ? error.status : 503;
  const code = error instanceof ZodError ? "LINE_PAY_INPUT_INVALID" : error instanceof PaymentProviderError ? error.code : "LINE_PAY_TEMPORARILY_UNAVAILABLE";
  return NextResponse.json({ error: code }, { status,headers: paymentHeaders });
}
