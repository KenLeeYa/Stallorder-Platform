import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getRequestPrincipal } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { paymentRuntime } from "@/server/payment-providers/line-platform-payment-config";
import { paymentError,paymentHeaders,requirePaymentOrderOwner } from "@/server/payment-providers/line-platform-payment-http";
import { platformPaymentRepository } from "@/server/payment-providers/line-platform-payment-repository";
import { publicPaymentView } from "@/server/payment-providers/line-platform-payment-workflow";
import { PaymentProviderError } from "@/server/payment-providers/types";
export async function GET(request: Request,context: { params: Promise<{ orderId: string }> }) {
  try {
    const runtime=paymentRuntime(); const principal=await getRequestPrincipal(request);
    if(!principal) throw new PaymentProviderError("AUTHENTICATION_REQUIRED",401);
    if(!(await checkRateLimit({scope:"line-pay-order-status",identifier:principal.user.id,limit:60,windowMs:60_000})).allowed) throw new PaymentProviderError("RATE_LIMITED",429);
    const orderId=z.string().uuid().parse((await context.params).orderId);
    await requirePaymentOrderOwner(principal,orderId);
    const rows=await prisma.$queryRaw<Array<{ transaction_id: string }>>(Prisma.sql`select transaction_id from public.line_platform_payment_attempts where order_id=${orderId}::uuid and environment=${runtime.environment} order by created_at desc limit 1`);
    return NextResponse.json({ payment: rows[0] ? publicPaymentView(await platformPaymentRepository.view(rows[0].transaction_id)) : null },{ headers: paymentHeaders });
  } catch(error) { return paymentError(error); }
}
