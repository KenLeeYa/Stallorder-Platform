import { NextResponse } from "next/server";
import { authorizePlatformAdminApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import { billingWorkflowErrorResponse } from "@/server/billing/billing-workflow-http";
import { billingWorkflowService } from "@/server/billing/billing-workflow-service";
import { adminInvoiceActionSchema, adminInvoiceLineSchema } from "@/server/billing/billing-validation";

type RouteContext = { params: Promise<{ invoiceId: string }> };

async function authorizedBody(request: Request) {
  const authorization = await authorizePlatformAdminApiRequest(request);
  if (!authorization.ok) return { error: authorization.response } as const;
  if (!validateCsrf(request, authorization.principal)) {
    return {
      error: NextResponse.json(
        { error: "安全驗證已失效，請重新整理後再試。" },
        { status: 403, headers: { "x-request-id": authorization.requestId } },
      ),
    } as const;
  }
  const body = await readJson(request, authorization.requestId);
  if (body.error) return { error: body.error } as const;
  return { authorization, data: body.data } as const;
}

export async function POST(request: Request, context: RouteContext) {
  const { invoiceId } = await context.params;
  const result = await authorizedBody(request);
  if ("error" in result) return result.error;
  const parsed = adminInvoiceLineSchema.safeParse(result.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "帳單項目資料不正確。" },
      { status: 400, headers: { "x-request-id": result.authorization.requestId } },
    );
  }
  try {
    const output = await billingWorkflowService.addInvoiceLine(invoiceId, parsed.data, {
      actorProfileId: result.authorization.principal.user.id,
      requestId: result.authorization.requestId,
      ipHash: hashClientIp(request),
    });
    return NextResponse.json(output, { status: 201, headers: { "cache-control": "no-store", "x-request-id": result.authorization.requestId } });
  } catch (error) {
    const response = billingWorkflowErrorResponse(error, result.authorization.requestId);
    if (response) return response;
    throw error;
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { invoiceId } = await context.params;
  const result = await authorizedBody(request);
  if ("error" in result) return result.error;
  const parsed = adminInvoiceActionSchema.safeParse(result.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "帳單操作資料不正確。" },
      { status: 400, headers: { "x-request-id": result.authorization.requestId } },
    );
  }
  try {
    const invoice = await billingWorkflowService.voidInvoice(invoiceId, parsed.data.reason, {
      actorProfileId: result.authorization.principal.user.id,
      requestId: result.authorization.requestId,
      ipHash: hashClientIp(request),
    });
    return NextResponse.json({ invoice }, { headers: { "cache-control": "no-store", "x-request-id": result.authorization.requestId } });
  } catch (error) {
    const response = billingWorkflowErrorResponse(error, result.authorization.requestId);
    if (response) return response;
    throw error;
  }
}
