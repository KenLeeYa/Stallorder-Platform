import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import { eInvoiceCommandSchema } from "@/server/e-invoice/e-invoice-contract";
import { getMerchantEInvoiceData, bootstrapLocalMockEInvoice, InvoiceSetupError } from "@/server/e-invoice/e-invoice-service";
import { invoiceOrchestrator, InvoiceOperationError } from "@/server/e-invoice/invoice-orchestrator";

type RouteContext = { params: Promise<{ organizationId: string }> };
const noStore = (requestId: string) => ({ "cache-control": "no-store", "x-request-id": requestId });

export async function GET(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(request, organizationId, "MANAGE_PAYMENT_INTEGRATIONS");
  if (!authorization.ok) return authorization.response;
  try {
    return NextResponse.json(await getMerchantEInvoiceData(organizationId), { headers: noStore(authorization.requestId) });
  } catch (error) {
    return invoiceErrorResponse(error, authorization.requestId);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(request, organizationId, "MANAGE_PAYMENT_INTEGRATIONS");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    await recordAuditEvent({
      organizationId,
      actorProfileId: authorization.principal.user.id,
      action: "CSRF_VALIDATION_FAILED",
      entityType: "EINVOICE",
      outcome: "DENIED",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
    });
    return NextResponse.json({ error: "安全驗證已失效，請重新整理後再試。" }, { status: 403, headers: noStore(authorization.requestId) });
  }
  const body = await readJson(request, authorization.requestId, { maxBytes: 12_000 });
  if (body.error) return body.error;
  const parsed = eInvoiceCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "電子發票測試資料格式不正確。" }, { status: 400, headers: noStore(authorization.requestId) });
  }
  const idempotencyKey = request.headers.get("x-idempotency-key")?.trim();
  if (parsed.data.operation !== "BOOTSTRAP_MOCK" && (!idempotencyKey || idempotencyKey.length > 120)) {
    return NextResponse.json({ error: "缺少有效的防重複操作識別碼。" }, { status: 400, headers: noStore(authorization.requestId) });
  }
  try {
    const common = {
      organizationId,
      idempotencyKey: idempotencyKey ?? authorization.requestId,
      correlationId: authorization.requestId,
    };
    if (parsed.data.operation === "BOOTSTRAP_MOCK") {
      await bootstrapLocalMockEInvoice({
        organizationId,
        actorProfileId: authorization.principal.user.id,
        provider: parsed.data.provider,
        correlationId: authorization.requestId,
      });
    } else if (parsed.data.operation === "ISSUE") {
      await invoiceOrchestrator.issue({ ...common, orderId: parsed.data.orderId, buyer: parsed.data.buyer });
    } else if (parsed.data.operation === "QUERY") {
      await invoiceOrchestrator.query({ ...common, invoiceDocumentId: parsed.data.invoiceDocumentId });
    } else if (parsed.data.operation === "VOID") {
      await invoiceOrchestrator.void({ ...common, invoiceDocumentId: parsed.data.invoiceDocumentId, reason: parsed.data.reason });
    } else if (parsed.data.operation === "ALLOWANCE") {
      await invoiceOrchestrator.allowance({ ...common, invoiceDocumentId: parsed.data.invoiceDocumentId, amount: parsed.data.amount, reason: parsed.data.reason });
    } else if (parsed.data.operation === "ALLOWANCE_VOID") {
      await invoiceOrchestrator.voidAllowance({ ...common, invoiceDocumentId: parsed.data.invoiceDocumentId });
    } else {
      await invoiceOrchestrator.reconcile({ ...common, invoiceDocumentId: parsed.data.invoiceDocumentId });
    }
    await recordAuditEvent({
      organizationId,
      actorProfileId: authorization.principal.user.id,
      action: `EINVOICE_${parsed.data.operation}`,
      entityType: "EINVOICE",
      entityId: "invoiceDocumentId" in parsed.data ? parsed.data.invoiceDocumentId : undefined,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      metadata: {
        operation: parsed.data.operation,
        provider: "provider" in parsed.data ? parsed.data.provider : null,
        localMock: true,
      },
    });
    return NextResponse.json(await getMerchantEInvoiceData(organizationId), { headers: noStore(authorization.requestId) });
  } catch (error) {
    await recordAuditEvent({
      organizationId,
      actorProfileId: authorization.principal.user.id,
      action: `EINVOICE_${parsed.data.operation}`,
      entityType: "EINVOICE",
      entityId: "invoiceDocumentId" in parsed.data ? parsed.data.invoiceDocumentId : undefined,
      outcome: "FAILURE",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      metadata: { operation: parsed.data.operation, errorCode: error instanceof Error ? error.message.slice(0, 120) : "EINVOICE_OPERATION_FAILED" },
    });
    return invoiceErrorResponse(error, authorization.requestId);
  }
}

function invoiceErrorResponse(error: unknown, requestId: string) {
  const known = error instanceof InvoiceOperationError || error instanceof InvoiceSetupError;
  const status = known ? error.status : 500;
  const code = known ? error.code : "EINVOICE_OPERATION_FAILED";
  const messages: Record<string, string> = {
    EINVOICE_SETUP_INCOMPLETE: "請先完成本機 Mock 賣方、供應商與政策設定。",
    INVOICE_ORDER_NOT_FOUND: "找不到指定訂單。",
    INVOICE_ORDER_NOT_PAID_AND_COMPLETED: "只有已付款且已完成的訂單可執行本機測試開票。",
    INVOICE_MOBILE_BARCODE_INVALID: "手機條碼載具格式不正確。",
    INVOICE_DONATION_CODE_INVALID: "捐贈碼格式不正確。",
    INVOICE_IDEMPOTENCY_CONFLICT: "相同操作識別碼已用於不同內容，請重新整理後再試。",
    INVOICE_OPERATION_ALREADY_STARTED: "此操作已在處理中，請稍後重新查詢。",
    INVOICE_OPERATION_CONCURRENT_MODIFICATION: "電子發票狀態已由其他操作更新，請重新整理後再試。",
    INVOICE_BUYER_SNAPSHOT_LOCKED: "此文件已鎖定原始買方資料；如需更正請先依正式流程處理。",
    EINVOICE_MERCHANT_SETUP_DISABLED: "電子發票測試功能目前已停用。",
    ECPAY_EINVOICE_CONTRACT_NOT_VERIFIED: "ECPay 正式契約尚未驗證，目前只能使用本機 Mock。",
    EZPAY_EINVOICE_CONTRACT_NOT_VERIFIED: "ezPay 正式契約尚未驗證，目前只能使用本機 Mock。",
    TRADEVAN_EINVOICE_CONTRACT_NOT_VERIFIED: "TradeVan 正式契約尚未驗證，目前只能使用本機 Mock。",
  };
  return NextResponse.json({ error: messages[code] ?? "目前無法完成電子發票操作。", code }, { status, headers: noStore(requestId) });
}
