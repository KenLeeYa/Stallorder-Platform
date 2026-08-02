import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeStallManagementApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { getZodFieldErrors } from "@/lib/form-field-errors";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import { stallScheduleCommandSchema } from "@/lib/stall-schedule-contract";
import {
  noStoreHeaders,
  requireJsonContentType,
  stallScheduleErrorResponse,
} from "@/lib/stall-schedule-http";
import {
  applyStallScheduleCommand,
  getStallScheduleManagerData,
  invalidateStallSchedulePublicData,
  scheduleAuditAction,
} from "@/lib/stall-schedules";

type RouteContext = { params: Promise<{ stallId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { stallId } = await context.params;
  const authorization = await authorizeStallManagementApiRequest(
    request,
    stallId,
    "MANAGE_STALL_SCHEDULES",
  );
  if (!authorization.ok) return authorization.response;
  try {
    return NextResponse.json(
      await getStallScheduleManagerData(authorization.workspace.id, stallId),
      { headers: noStoreHeaders(authorization.requestId) },
    );
  } catch (error) {
    return stallScheduleErrorResponse(error, authorization.requestId);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { stallId } = await context.params;
  const authorization = await authorizeStallManagementApiRequest(
    request,
    stallId,
    "MANAGE_STALL_SCHEDULES",
  );
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: noStoreHeaders(authorization.requestId) },
    );
  }
  const contentTypeError = requireJsonContentType(request, authorization.requestId);
  if (contentTypeError) return contentTypeError;
  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = stallScheduleCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    const fieldErrors = getZodFieldErrors(parsed.error, {
      locationId: "常用地點",
      marketEventId: "市集活動",
      startsAt: "行程開始",
      endsAt: "行程結束",
      orderingOpensAt: "開放接單時間",
      orderingClosesAt: "停止接單時間",
      specialNotice: "公開臨時公告",
      reason: "操作原因",
      weeks: "複製週數",
      qrCodeId: "QR Code",
      scheduleId: "綁定行程",
      fulfillmentType: "點餐類型",
    });
    if (body.data && typeof body.data === "object" && body.data.operation === "SET_STATUS" && fieldErrors.specialNotice) {
      fieldErrors.actionNotice = fieldErrors.specialNotice;
      delete fieldErrors.specialNotice;
    }
    return NextResponse.json(
      { error: Object.values(fieldErrors)[0] ?? "行程資料不正確。", fieldErrors },
      { status: 400, headers: noStoreHeaders(authorization.requestId) },
    );
  }
  try {
    const result = await applyStallScheduleCommand({
      organizationId: authorization.workspace.id,
      stallId,
      command: parsed.data,
    });
    const createdEntityId = parsed.data.operation === "CREATE"
      && !Array.isArray(result)
      && typeof result === "object"
      && result !== null
      && "id" in result
      && typeof result.id === "string"
      ? result.id
      : undefined;
    await recordAuditEvent({
      organizationId: authorization.workspace.id,
      stallId,
      actorProfileId: authorization.principal.user.id,
      action: scheduleAuditAction(parsed.data),
      entityType: parsed.data.operation === "ASSIGN_QR_CONTEXT" ? "QR_CODE" : "STALL_SCHEDULE",
      entityId: parsed.data.operation === "CREATE"
        ? createdEntityId
        : parsed.data.operation === "ASSIGN_QR_CONTEXT"
          ? parsed.data.qrCodeId
          : parsed.data.scheduleId,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      metadata: {
        operation: parsed.data.operation,
        ...("reason" in parsed.data ? { reason: parsed.data.reason } : {}),
        ...(parsed.data.operation === "SET_STATUS" ? { status: parsed.data.status } : {}),
      },
    });
    await invalidateStallSchedulePublicData(authorization.workspace.id, stallId);
    return NextResponse.json(
      await getStallScheduleManagerData(authorization.workspace.id, stallId),
      { headers: noStoreHeaders(authorization.requestId) },
    );
  } catch (error) {
    return stallScheduleErrorResponse(error, authorization.requestId);
  }
}
