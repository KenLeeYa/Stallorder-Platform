import { NextResponse } from "next/server";
import { authorizePlatformAdminApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import { billingWorkflowErrorResponse } from "@/server/billing/billing-workflow-http";
import { billingWorkflowService } from "@/server/billing/billing-workflow-service";
import { subscriptionActionSchema } from "@/server/billing/billing-validation";

type RouteContext = { params: Promise<{ subscriptionId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { subscriptionId } = await context.params;
  const authorization = await authorizePlatformAdminApiRequest(request);
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json({ error: "安全驗證已失效，請重新整理後再試。" }, { status: 403, headers: { "x-request-id": authorization.requestId } });
  }
  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = subscriptionActionSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "訂閱操作資料不正確。" }, { status: 400, headers: { "x-request-id": authorization.requestId } });
  }
  const contextData = { actorProfileId: authorization.principal.user.id, requestId: authorization.requestId, ipHash: hashClientIp(request) };
  try {
    if (parsed.data.operation === "ASSIGN_ORDER_PACKAGE") {
      const result = await billingWorkflowService.assignOrderPackage(subscriptionId, parsed.data, contextData);
      return NextResponse.json({ result }, { headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } });
    }
    if (parsed.data.operation === "REBUILD_USAGE") {
      const count = await billingWorkflowService.rebuildUsageSummary(subscriptionId, new Date(`${parsed.data.billingPeriod}T00:00:00.000Z`), contextData);
      return NextResponse.json({ count }, { headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } });
    }
    const subscription = await billingWorkflowService.transitionSubscription(
      subscriptionId,
      parsed.data.operation,
      parsed.data,
      contextData,
    );
    return NextResponse.json({ subscription }, { headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } });
  } catch (error) {
    const response = billingWorkflowErrorResponse(error, authorization.requestId);
    if (response) return response;
    throw error;
  }
}
