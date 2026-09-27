import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestPrincipal } from "@/lib/auth";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { platformPaymentWorkflow } from "@/server/payment-providers/line-platform-payment-workflow";
import { paymentError, paymentHeaders, requirePaymentOrderOwner } from "@/server/payment-providers/line-platform-payment-http";
const schema = z.object({ orderId: z.string().uuid(),expectedAmount: z.number().int().positive().max(100_000_000),orderVersion: z.string().datetime() }).strict();
export async function POST(request: Request) {
  const principal = await getRequestPrincipal(request);
  if (!principal) return NextResponse.json({ error: "請先登入。" },{ status: 401,headers: paymentHeaders });
  if (!validateCsrf(request,principal)) return NextResponse.json({ error: "安全驗證失敗。" },{ status: 403,headers: paymentHeaders });
  const rate = await checkRateLimit({ scope: "line-pay-checkout",identifier: principal.user.id,limit: 10,windowMs: 60_000 });
  if (!rate.allowed) return NextResponse.json({ error: "操作過於頻繁。" },{ status: 429,headers: paymentHeaders });
  const body = await readJson(request,"line-pay-checkout",{ maxBytes: 2048 }); if (body.error) return body.error;
  try {
    const input = schema.parse(body.data); const idempotencyKey = z.string().uuid().parse(request.headers.get("x-idempotency-key"));
    await requirePaymentOrderOwner(principal,input.orderId);
    const payment = await platformPaymentWorkflow(true).checkout({ ...input,idempotencyKey,profileId: principal.user.id });
    return NextResponse.json({ payment },{ headers: paymentHeaders });
  } catch (error) { return paymentError(error); }
}
