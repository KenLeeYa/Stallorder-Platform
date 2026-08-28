import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { getZodFieldErrors } from "@/lib/form-field-errors";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import { workforceManagerCommandSchema } from "@/server/workforce/workforce-contract";
import {
  applyWorkforceManagerCommand,
  getWorkforceDashboard,
  WorkforceOperationError,
} from "@/server/workforce/workforce-service";

type RouteContext = { params: Promise<{ organizationId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(request, organizationId, "MANAGE_ATTENDANCE");
  if (!authorization.ok) return authorization.response;
  const range = requestedRange(request);
  try {
    return NextResponse.json(
      await getWorkforceDashboard({ organizationId, ...range }),
      { headers: noStoreHeaders(authorization.requestId) },
    );
  } catch (error) {
    return errorResponse(error, authorization.requestId);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(request, organizationId, "MANAGE_ATTENDANCE");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: noStoreHeaders(authorization.requestId) },
    );
  }
  const body = await readJson(request, authorization.requestId, { maxBytes: 32_768 });
  if (body.error) return body.error;
  const parsed = workforceManagerCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({
      error: "人員與薪資資料不正確，請檢查標示欄位。",
      fieldErrors: getZodFieldErrors(parsed.error, {
        profileId: "員工",
        stallId: "攤位",
        hourlyRate: "時薪",
        effectiveFrom: "生效日",
        effectiveTo: "結束日",
        workDate: "排班日期",
        scheduleId: "班表",
        shiftStartAt: "上班時間",
        shiftEndAt: "下班時間",
        unpaidBreakMinutes: "不計薪休息",
        holidayDate: "假日日期",
        multiplierBps: "時薪倍率",
        periodStart: "薪資起日",
        periodEnd: "薪資迄日",
      }),
    }, { status: 400, headers: noStoreHeaders(authorization.requestId) });
  }

  try {
    const result = await applyWorkforceManagerCommand({
      organizationId,
      actorProfileId: authorization.principal.user.id,
      command: parsed.data,
    });
    await recordAuditEvent({
      organizationId,
      actorProfileId: authorization.principal.user.id,
      action: `WORKFORCE_${parsed.data.operation}`,
      entityType: "WORKFORCE",
      entityId: "id" in result ? result.id : undefined,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      metadata: { operation: parsed.data.operation },
    });
    return NextResponse.json(
      await getWorkforceDashboard({ organizationId, ...requestedRange(request) }),
      { headers: noStoreHeaders(authorization.requestId) },
    );
  } catch (error) {
    return errorResponse(error, authorization.requestId);
  }
}

function requestedRange(request: Request) {
  const url = new URL(request.url);
  const today = new Date().toISOString().slice(0, 10);
  return {
    dateFrom: url.searchParams.get("dateFrom") ?? `${today.slice(0, 8)}01`,
    dateTo: url.searchParams.get("dateTo") ?? today,
  };
}

function errorResponse(error: unknown, requestId: string) {
  const code = error instanceof WorkforceOperationError ? error.code : "WORKFORCE_UPDATE_FAILED";
  const response = workforceError(code);
  return NextResponse.json(
    { error: response.message },
    { status: response.status, headers: noStoreHeaders(requestId) },
  );
}

function workforceError(code: string) {
  switch (code) {
    case "WORKFORCE_DATE_RANGE_INVALID":
    case "WORKFORCE_DATE_RANGE_TOO_LARGE":
      return { status: 400, message: "日期區間不正確或範圍過大。" };
    case "WORKFORCE_EMPLOYEE_NOT_FOUND":
    case "WORKFORCE_STALL_NOT_FOUND":
      return { status: 404, message: "找不到指定的員工或攤位。" };
    case "WORKFORCE_LEAVE_NOT_REVIEWABLE":
      return { status: 409, message: "這筆休假申請已經處理，請重新整理。" };
    case "WORKFORCE_LEAVE_NOT_CANCELLABLE":
      return { status: 409, message: "這筆休假申請已無法取消，請重新整理。" };
    case "WORKFORCE_SCHEDULE_NOT_CANCELLABLE":
      return { status: 409, message: "這筆班表已取消或不存在，請重新整理。" };
    case "WORKFORCE_WAGE_RATE_MISSING":
      return { status: 409, message: "仍有工時缺少有效時薪，請先補齊再產生薪資單。" };
    case "WORKFORCE_PAYROLL_FINALIZED":
    case "WORKFORCE_PAYROLL_NOT_FINALIZABLE":
      return { status: 409, message: "此薪資期間已結案，不能重新計算或再次結案。" };
    case "WORKFORCE_PAYROLL_EMPTY":
      return { status: 409, message: "薪資單沒有可結案的員工明細。" };
    default:
      return { status: 500, message: "目前無法更新員工薪資資料，請稍後再試。" };
  }
}

function noStoreHeaders(requestId: string) {
  return { "cache-control": "private, no-store", "x-request-id": requestId };
}
