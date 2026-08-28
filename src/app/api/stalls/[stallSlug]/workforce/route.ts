import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { getZodFieldErrors } from "@/lib/form-field-errors";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import { leaveRequestCommandSchema } from "@/server/workforce/workforce-contract";
import {
  cancelEmployeeLeaveRequest,
  createEmployeeLeaveRequest,
  getEmployeeWorkforceSnapshot,
  WorkforceOperationError,
} from "@/server/workforce/workforce-service";

type RouteContext = { params: Promise<{ stallSlug: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "USE_ATTENDANCE");
  if (!authorization.ok) return authorization.response;
  return NextResponse.json(await getEmployeeWorkforceSnapshot({
    organizationId: authorization.stall.organizationId,
    stallId: authorization.stall.id,
    profileId: authorization.principal.user.id,
  }), { headers: noStoreHeaders(authorization.requestId) });
}

export async function POST(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "USE_ATTENDANCE");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: noStoreHeaders(authorization.requestId) },
    );
  }
  const body = await readJson(request, authorization.requestId, { maxBytes: 8_192 });
  if (body.error) return body.error;
  const parsed = leaveRequestCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({
      error: "休假資料不正確，請檢查標示欄位。",
      fieldErrors: getZodFieldErrors(parsed.error, {
        leaveType: "假別",
        startDate: "開始日",
        endDate: "結束日",
        reason: "說明",
      }),
    }, { status: 400, headers: noStoreHeaders(authorization.requestId) });
  }
  try {
    const commandInput = {
      organizationId: authorization.stall.organizationId,
      stallId: authorization.stall.id,
      profileId: authorization.principal.user.id,
    };
    const result = parsed.data.operation === "CREATE_LEAVE_REQUEST"
      ? await createEmployeeLeaveRequest({ ...commandInput, command: parsed.data })
      : await cancelEmployeeLeaveRequest({ ...commandInput, command: parsed.data });
    await recordAuditEvent({
      organizationId: authorization.stall.organizationId,
      stallId: authorization.stall.id,
      actorProfileId: authorization.principal.user.id,
      action: parsed.data.operation === "CREATE_LEAVE_REQUEST"
        ? "WORKFORCE_LEAVE_REQUESTED"
        : "WORKFORCE_LEAVE_CANCELLED",
      entityType: "WORKFORCE_LEAVE_REQUEST",
      entityId: result.id,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
    });
    return NextResponse.json(await getEmployeeWorkforceSnapshot({
      organizationId: authorization.stall.organizationId,
      stallId: authorization.stall.id,
      profileId: authorization.principal.user.id,
    }), { status: 201, headers: noStoreHeaders(authorization.requestId) });
  } catch (error) {
    const code = error instanceof WorkforceOperationError ? error.code : "WORKFORCE_LEAVE_CREATE_FAILED";
    const message = code === "WORKFORCE_LEAVE_OVERLAP"
      ? "此日期已經有待審或已核准的休假申請。"
      : code === "WORKFORCE_LEAVE_NOT_CANCELLABLE"
        ? "這筆休假申請已處理或取消，請重新整理。"
      : code === "WORKFORCE_DATE_RANGE_TOO_LARGE"
        ? "單次休假申請最多 31 天。"
        : "目前無法送出休假申請，請稍後再試。";
    return NextResponse.json(
      { error: message },
      { status: code === "WORKFORCE_LEAVE_CREATE_FAILED" ? 500 : 409, headers: noStoreHeaders(authorization.requestId) },
    );
  }
}

function noStoreHeaders(requestId: string) {
  return { "cache-control": "private, no-store", "x-request-id": requestId };
}
