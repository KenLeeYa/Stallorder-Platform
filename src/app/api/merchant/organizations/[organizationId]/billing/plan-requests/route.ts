import { NextResponse } from "next/server";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import { billingWorkflowErrorResponse } from "@/server/billing/billing-workflow-http";
import { billingWorkflowService } from "@/server/billing/billing-workflow-service";
import { planChangeRequestSchema } from "@/server/billing/billing-validation";
import { isBillingFeatureEnabled } from "@/server/billing/billing-feature-flags";

type RouteContext = { params: Promise<{ organizationId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(request, organizationId, "MANAGE_SUBSCRIPTION");
  if (!authorization.ok) return authorization.response;
  if (!await isBillingFeatureEnabled("MERCHANT_BILLING_VISIBLE")) {
    return NextResponse.json({ error: "找不到指定的功能。" }, { status: 404, headers: { "x-request-id": authorization.requestId } });
  }
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json({ error: "安全驗證已失效，請重新整理後再試。" }, { status: 403, headers: { "x-request-id": authorization.requestId } });
  }
  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = planChangeRequestSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "方案申請資料不正確。" }, { status: 400, headers: { "x-request-id": authorization.requestId } });
  }
  try {
    const changeRequest = await billingWorkflowService.requestPlanChange(
      organizationId,
      parsed.data,
      { actorProfileId: authorization.principal.user.id, requestId: authorization.requestId, ipHash: hashClientIp(request) },
    );
    return NextResponse.json({ changeRequest }, { status: 201, headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } });
  } catch (error) {
    const response = billingWorkflowErrorResponse(error, authorization.requestId);
    if (response) return response;
    throw error;
  }
}
