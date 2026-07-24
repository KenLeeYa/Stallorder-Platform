import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizePlatformAdminApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import { billingWorkflowErrorResponse } from "@/server/billing/billing-workflow-http";
import { billingWorkflowService } from "@/server/billing/billing-workflow-service";
import { paymentDecisionSchema } from "@/server/billing/billing-validation";

const decisionSchema = paymentDecisionSchema.extend({ operation: z.enum(["VERIFY", "REJECT"]) }).strict();
type RouteContext = { params: Promise<{ paymentId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { paymentId } = await context.params;
  const authorization = await authorizePlatformAdminApiRequest(request);
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json({ error: "安全驗證已失效，請重新整理後再試。" }, { status: 403, headers: { "x-request-id": authorization.requestId } });
  }
  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = decisionSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "付款審核資料不正確。" }, { status: 400, headers: { "x-request-id": authorization.requestId } });
  }
  try {
    const contextData = { actorProfileId: authorization.principal.user.id, requestId: authorization.requestId, ipHash: hashClientIp(request) };
    const result = parsed.data.operation === "VERIFY"
      ? await billingWorkflowService.verifyManualPayment(paymentId, parsed.data.note, contextData)
      : await billingWorkflowService.rejectManualPayment(paymentId, parsed.data.note, contextData);
    return NextResponse.json({ result }, { headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } });
  } catch (error) {
    const response = billingWorkflowErrorResponse(error, authorization.requestId);
    if (response) return response;
    throw error;
  }
}
