import { NextResponse } from "next/server";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import { billingWorkflowErrorResponse } from "@/server/billing/billing-workflow-http";
import { billingWorkflowService } from "@/server/billing/billing-workflow-service";
import { manualPaymentSubmissionSchema, parseIdempotencyKey } from "@/server/billing/billing-validation";

type RouteContext = { params: Promise<{ organizationId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(request, organizationId, "MANAGE_SUBSCRIPTION");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json({ error: "安全驗證已失效，請重新整理後再試。" }, { status: 403, headers: { "x-request-id": authorization.requestId } });
  }
  const idempotencyKey = parseIdempotencyKey(request);
  if (!idempotencyKey) {
    return NextResponse.json({ error: "缺少有效的付款防重複識別。" }, { status: 400, headers: { "x-request-id": authorization.requestId } });
  }
  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = manualPaymentSubmissionSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "付款資料不正確。" }, { status: 400, headers: { "x-request-id": authorization.requestId } });
  }
  try {
    const result = await billingWorkflowService.submitManualPayment(
      organizationId,
      { ...parsed.data, receivedAt: new Date(parsed.data.receivedAt), idempotencyKey },
      { actorProfileId: authorization.principal.user.id, requestId: authorization.requestId, ipHash: hashClientIp(request) },
    );
    return NextResponse.json(result, { status: result.idempotent ? 200 : 201, headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } });
  } catch (error) {
    const response = billingWorkflowErrorResponse(error, authorization.requestId);
    if (response) return response;
    throw error;
  }
}
