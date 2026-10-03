import "server-only";
import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { hashClientIp } from "@/lib/security";
import { platformPaymentWorkflow } from "./line-platform-payment-workflow";
import { paymentError, paymentHeaders } from "./line-platform-payment-http";
export async function handlePaymentReturn(request: Request, cancel: boolean) {
  try {
    const rate = await checkRateLimit({ scope: "line-pay-return",identifier: hashClientIp(request),limit: 30,windowMs: 60_000 });
    if (!rate.allowed) return NextResponse.json({ error: "操作過於頻繁。" },{ status: 429,headers: paymentHeaders });
    const query = new URL(request.url).searchParams;
    const workflow = platformPaymentWorkflow();
    const attempt = await workflow.resolveReturn({ state: query.get("state") ?? "",transactionId: query.get("transactionId") ?? undefined,orderId: query.get("orderId") ?? undefined,cancel });
    // Redirect contains no provider/state secrets; order page independently authenticates ownership.
    try { await workflow.recover(attempt.id,!cancel); } catch { /* pending/unknown remains visible at the protected order page */ }
    return new NextResponse(null,{ status: 303,headers: { ...paymentHeaders,location: `/mini/orders/${attempt.orderId}` } });
  } catch (error) { return paymentError(error); }
}
