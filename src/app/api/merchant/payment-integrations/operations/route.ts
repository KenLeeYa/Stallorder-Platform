import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeStallManagementApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { platformPaymentWorkflow } from "@/server/payment-providers/line-platform-payment-workflow";
import { platformPaymentRepository } from "@/server/payment-providers/line-platform-payment-repository";
import { paymentError,paymentHeaders } from "@/server/payment-providers/line-platform-payment-http";
import { PaymentProviderError } from "@/server/payment-providers/types";
import { paymentRuntime } from "@/server/payment-providers/line-platform-payment-config";
import { checkRateLimit } from "@/lib/rate-limit";
const schema = z.discriminatedUnion("action",[
  z.object({ action: z.literal("RECONCILE"),attemptId: z.string().uuid(),stallId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("REFUND"),attemptId: z.string().uuid(),stallId: z.string().uuid(),amount: z.number().int().positive().max(100_000_000).optional(),reason: z.string().trim().min(3).max(500) }).strict(),
]);
export async function GET(request: Request) {
  try {
    const stallId=z.string().uuid().parse(new URL(request.url).searchParams.get("stallId"));
    const authorization=await authorizeStallManagementApiRequest(request,stallId,"MANAGE_PAYMENT_INTEGRATIONS");
    if(!authorization.ok)return authorization.response;
    const rate=await checkRateLimit({scope:"line-pay-merchant-read",identifier:authorization.principal.user.id,limit:60,windowMs:60_000});
    if(!rate.allowed)throw new PaymentProviderError("LINE_PAY_RATE_LIMITED",429);
    const runtime=paymentRuntime(false);
    const payments=await platformPaymentRepository.listMerchant(authorization.workspace.id,stallId,runtime.environment);
    return NextResponse.json({payments},{headers:paymentHeaders});
  } catch(error){return paymentError(error);}
}
export async function POST(request: Request) {
  const body = await readJson(request,"line-pay-operation",{ maxBytes: 4096 }); if (body.error) return body.error;
  try {
    const input = schema.parse(body.data);
    const authorization = await authorizeStallManagementApiRequest(request,input.stallId,"MANAGE_PAYMENT_INTEGRATIONS");
    if (!authorization.ok) return authorization.response;
    if (!validateCsrf(request,authorization.principal)) return NextResponse.json({ error: "安全驗證失敗。" },{ status: 403,headers: paymentHeaders });
    const rate=await checkRateLimit({scope:"line-pay-merchant-operation",identifier:authorization.principal.user.id,limit:20,windowMs:60_000});
    if(!rate.allowed)throw new PaymentProviderError("LINE_PAY_RATE_LIMITED",429);
    const runtime=paymentRuntime(false);
    const attempt = await platformPaymentRepository.view(input.attemptId,{organizationId:authorization.workspace.id,stallId:input.stallId,environment:runtime.environment});
    if (attempt.stallId !== input.stallId || attempt.organizationId !== authorization.workspace.id) throw new PaymentProviderError("LINE_PAY_ATTEMPT_NOT_FOUND",404);
    const workflow = platformPaymentWorkflow();
    const payment = input.action === "RECONCILE" ? await workflow.recover(attempt.id,false)
      : await workflow.refund({ attemptId: attempt.id,stallId: input.stallId,actorProfileId: authorization.principal.user.id,amount: input.amount,reason: input.reason,idempotencyKey: z.string().uuid().parse(request.headers.get("x-idempotency-key")) });
    return NextResponse.json({ payment },{ headers: paymentHeaders });
  } catch (error) { return paymentError(error); }
}
