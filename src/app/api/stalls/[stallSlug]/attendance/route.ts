import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { attendanceAttemptSchema } from "@/lib/attendance-contract";
import { authorizeApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { hashClientIp } from "@/lib/security";
import {
  AttendanceError,
  getEmployeeAttendanceSnapshot,
  submitAttendanceAttempt,
} from "@/server/attendance/attendance-service";

type RouteContext = { params: Promise<{ stallSlug: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "USE_ATTENDANCE");
  if (!authorization.ok) return authorization.response;
  try {
    return NextResponse.json(
      await getEmployeeAttendanceSnapshot({
        organizationId: authorization.stall.organizationId,
        stallId: authorization.stall.id,
        profileId: authorization.principal.user.id,
        sessionId: authorization.principal.sessionId,
        timezone: authorization.stall.timezone,
      }),
      { headers: noStoreHeaders(authorization.requestId) },
    );
  } catch (error) {
    return attendanceErrorResponse(error, authorization.requestId);
  }
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
  const limit = await checkRateLimit({
    scope: "attendance-submit",
    identifier: `${authorization.principal.user.id}:${authorization.stall.id}`,
    limit: 15,
    windowMs: 5 * 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "打卡嘗試次數過多，請稍後再試。" },
      {
        status: 429,
        headers: {
          ...noStoreHeaders(authorization.requestId),
          "retry-after": String(limit.retryAfterSeconds),
        },
      },
    );
  }
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    return NextResponse.json(
      { error: "Content-Type 必須是 application/json。" },
      { status: 415, headers: noStoreHeaders(authorization.requestId) },
    );
  }
  const body = await readJson(request, authorization.requestId, { maxBytes: 8_192 });
  if (body.error) return body.error;
  const parsed = attendanceAttemptSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "打卡資料不正確。" },
      { status: 400, headers: noStoreHeaders(authorization.requestId) },
    );
  }
  try {
    const event = await submitAttendanceAttempt({
      organizationId: authorization.stall.organizationId,
      stallId: authorization.stall.id,
      profileId: authorization.principal.user.id,
      sessionId: authorization.principal.sessionId,
      attempt: parsed.data,
    });
    await recordAuditEvent({
      organizationId: authorization.stall.organizationId,
      stallId: authorization.stall.id,
      actorProfileId: authorization.principal.user.id,
      action: parsed.data.eventType === "CLOCK_IN" ? "ATTENDANCE_CLOCK_IN" : "ATTENDANCE_CLOCK_OUT",
      entityType: "ATTENDANCE_EVENT",
      entityId: event.id,
      outcome: event.decision === "ACCEPTED" ? "SUCCESS" : "DENIED",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      metadata: {
        decision: event.decision,
        evidenceStoredInAttendanceEvent: true,
      },
    });
    const status = event.decision === "ACCEPTED" ? 201 : 409;
    return NextResponse.json(
      { event },
      { status, headers: noStoreHeaders(authorization.requestId) },
    );
  } catch (error) {
    return attendanceErrorResponse(error, authorization.requestId);
  }
}

function attendanceErrorResponse(error: unknown, requestId: string) {
  if (!(error instanceof AttendanceError)) throw error;
  const messages: Record<AttendanceError["code"], string> = {
    ATTENDANCE_DISABLED: "店家尚未啟用定位打卡。",
    ATTENDANCE_POLICY_INCOMPLETE: "店家的打卡位置尚未設定完成。",
    CHALLENGE_INVALID: "打卡驗證已失效，請重新整理後再試。",
    CHALLENGE_EXPIRED: "打卡驗證已逾時，請重新整理後再試。",
    CHALLENGE_REPLAYED: "此打卡驗證已使用，請重新整理後再試。",
    EVENT_NOT_REVIEWABLE: "此紀錄無法覆核。",
  };
  const status = error.code === "ATTENDANCE_DISABLED" || error.code === "ATTENDANCE_POLICY_INCOMPLETE"
    ? 409
    : 400;
  return NextResponse.json(
    { error: messages[error.code], code: error.code },
    { status, headers: noStoreHeaders(requestId) },
  );
}

function noStoreHeaders(requestId: string) {
  return { "cache-control": "private, no-store", "x-request-id": requestId };
}
