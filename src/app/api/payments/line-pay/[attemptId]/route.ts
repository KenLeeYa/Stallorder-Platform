import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getRequestPrincipal } from "@/lib/auth";
import { validateCsrf } from "@/lib/csrf";
import { checkRateLimit } from "@/lib/rate-limit";
import { paymentRuntime } from "@/server/payment-providers/line-platform-payment-config";
import { paymentError,paymentHeaders,requirePaymentOrderOwner } from "@/server/payment-providers/line-platform-payment-http";
import { platformPaymentRepository } from "@/server/payment-providers/line-platform-payment-repository";
import { platformPaymentWorkflow,publicPaymentView } from "@/server/payment-providers/line-platform-payment-workflow";
import { PaymentProviderError } from "@/server/payment-providers/types";
type Context = { params: Promise<{ attemptId: string }> };
async function ownedAttempt(request: Request, context: Context, mutate: boolean) {
  const runtime = paymentRuntime();
  const principal = await getRequestPrincipal(request); if (!principal) throw new PaymentProviderError("AUTHENTICATION_REQUIRED",401);
  if (mutate && !validateCsrf(request,principal)) throw new PaymentProviderError("CSRF_INVALID",403);
  const id = z.string().uuid().parse((await context.params).attemptId);
  const rate = await checkRateLimit({ scope: "line-pay-status",identifier: principal.user.id,limit: 30,windowMs: 60_000 });
  if (!rate.allowed) throw new PaymentProviderError("RATE_LIMITED",429);
  const owners = await prisma.$queryRaw<Array<{ order_id: string }>>(Prisma.sql`select owner.order_id from public.line_platform_order_owners owner
    join public.line_platform_payment_attempts a on a.order_id=owner.order_id where a.transaction_id=${id}::uuid
    and owner.profile_id=${principal.user.id}::uuid and owner.environment=${runtime.environment} and a.environment=${runtime.environment}`);
  if (!owners.length) throw new PaymentProviderError("LINE_PAY_ATTEMPT_NOT_FOUND",404);
  await requirePaymentOrderOwner(principal,owners[0].order_id);
  return id;
}
export async function GET(request: Request, context: Context) {
  try { return NextResponse.json({ payment: publicPaymentView(await platformPaymentRepository.view(await ownedAttempt(request,context,false))) },{ headers: paymentHeaders }); }
  catch (error) { return paymentError(error); }
}
export async function POST(request: Request, context: Context) {
  try { return NextResponse.json({ payment: await platformPaymentWorkflow().recover(await ownedAttempt(request,context,true),true) },{ headers: paymentHeaders }); }
  catch (error) { return paymentError(error); }
}
