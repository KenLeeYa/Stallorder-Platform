import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { getZodFieldErrors } from "@/lib/form-field-errors";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import { operatingExpenseCommandSchema } from "@/server/finance/operating-profit-contract";
import {
  createOperatingExpense,
  getOperatingProfitDashboard,
  OperatingProfitError,
} from "@/server/finance/operating-profit-service";

type RouteContext = { params: Promise<{ organizationId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(request, organizationId, "VIEW_REPORTS");
  if (!authorization.ok) return authorization.response;
  try {
    return NextResponse.json(await getOperatingProfitDashboard({
      organizationId,
      stallIds: selectedStallIds(request, authorization.workspace.stalls),
      ...requestedRange(request),
    }), { headers: noStoreHeaders(authorization.requestId) });
  } catch (error) {
    return operatingProfitErrorResponse(error, authorization.requestId);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(request, organizationId, "MANAGE_ORGANIZATION");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: noStoreHeaders(authorization.requestId) },
    );
  }
  const body = await readJson(request, authorization.requestId, { maxBytes: 8_192 });
  if (body.error) return body.error;
  const parsed = operatingExpenseCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({
      error: "支出資料不正確，請檢查標示欄位。",
      fieldErrors: getZodFieldErrors(parsed.error, {
        stallId: "攤位",
        expenseDate: "支出日期",
        category: "支出分類",
        amount: "金額",
        vendorName: "收款方",
        description: "支出說明",
      }),
    }, { status: 400, headers: noStoreHeaders(authorization.requestId) });
  }
  try {
    const result = await createOperatingExpense({
      organizationId,
      actorProfileId: authorization.principal.user.id,
      command: parsed.data,
    });
    await recordAuditEvent({
      organizationId,
      stallId: parsed.data.stallId ?? undefined,
      actorProfileId: authorization.principal.user.id,
      action: "OPERATING_EXPENSE_CREATED",
      entityType: "OPERATING_EXPENSE",
      entityId: result.id,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      metadata: { category: parsed.data.category, amount: parsed.data.amount },
    });
    return NextResponse.json(await getOperatingProfitDashboard({
      organizationId,
      stallIds: selectedStallIds(request, authorization.workspace.stalls),
      ...requestedRange(request),
    }), { status: 201, headers: noStoreHeaders(authorization.requestId) });
  } catch (error) {
    return operatingProfitErrorResponse(error, authorization.requestId);
  }
}

function selectedStallIds(request: Request, stalls: readonly { id: string; isActive: boolean }[]) {
  const requested = new Set(new URL(request.url).searchParams.getAll("stallId"));
  const active = stalls.filter((stall) => stall.isActive);
  return (requested.size ? active.filter((stall) => requested.has(stall.id)) : active).map((stall) => stall.id);
}

function requestedRange(request: Request) {
  const url = new URL(request.url);
  const today = new Date().toISOString().slice(0, 10);
  return {
    dateFrom: url.searchParams.get("dateFrom") ?? `${today.slice(0, 8)}01`,
    dateTo: url.searchParams.get("dateTo") ?? today,
  };
}

function operatingProfitErrorResponse(error: unknown, requestId: string) {
  const code = error instanceof OperatingProfitError ? error.code : "OPERATING_PROFIT_FAILED";
  const status = code === "OPERATING_EXPENSE_STALL_NOT_FOUND" ? 404
    : code === "OPERATING_PROFIT_DATE_RANGE_INVALID" ? 400
      : 500;
  const message = code === "OPERATING_EXPENSE_STALL_NOT_FOUND"
    ? "找不到指定的攤位。"
    : code === "OPERATING_PROFIT_DATE_RANGE_INVALID"
      ? "日期區間不正確或超過一年。"
      : "目前無法讀取營運損益，請稍後再試。";
  return NextResponse.json({ error: message }, { status, headers: noStoreHeaders(requestId) });
}

function noStoreHeaders(requestId: string) {
  return { "cache-control": "private, no-store", "x-request-id": requestId };
}
