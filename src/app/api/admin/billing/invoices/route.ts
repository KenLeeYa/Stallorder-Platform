import { NextResponse } from "next/server";
import { authorizePlatformAdminApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import { billingWorkflowErrorResponse } from "@/server/billing/billing-workflow-http";
import { billingWorkflowService } from "@/server/billing/billing-workflow-service";
import { adminInvoiceCreateSchema } from "@/server/billing/billing-validation";

export async function POST(request: Request) {
  const authorization = await authorizePlatformAdminApiRequest(request);
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json({ error: "安全驗證已失效，請重新整理後再試。" }, { status: 403, headers: { "x-request-id": authorization.requestId } });
  }
  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = adminInvoiceCreateSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "帳單資料不正確。" }, { status: 400, headers: { "x-request-id": authorization.requestId } });
  }
  try {
    const invoice = await billingWorkflowService.createPlanInvoice(
      {
        organizationId: parsed.data.organizationId,
        planVersionId: parsed.data.planVersionId,
        billingInterval: parsed.data.billingInterval,
        dueAt: new Date(parsed.data.dueAt),
        changeRequestId: parsed.data.requestId,
      },
      { actorProfileId: authorization.principal.user.id, requestId: authorization.requestId, ipHash: hashClientIp(request) },
    );
    return NextResponse.json({ invoice }, { status: 201, headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } });
  } catch (error) {
    const response = billingWorkflowErrorResponse(error, authorization.requestId);
    if (response) return response;
    throw error;
  }
}
