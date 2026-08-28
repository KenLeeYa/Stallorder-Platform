import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { attendanceManagerCommandSchema } from "@/lib/attendance-contract";
import { authorizeStallManagementApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { hashClientIp } from "@/lib/security";
import {
  AttendanceError,
  getAttendanceManagerSnapshot,
  reviewAttendanceEvent,
  updateAttendancePolicy,
} from "@/server/attendance/attendance-service";

type RouteContext = { params: Promise<{ stallId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { stallId } = await context.params;
  const authorization = await authorizeStallManagementApiRequest(
    request,
    stallId,
    "MANAGE_ATTENDANCE",
  );
  if (!authorization.ok) return authorization.response;
  const timezone = await getStallTimezone(stallId, authorization.workspace.id);
  return NextResponse.json(
    await getAttendanceManagerSnapshot({
      organizationId: authorization.workspace.id,
      stallId,
      timezone,
    }),
    { headers: noStoreHeaders(authorization.requestId) },
  );
}

export async function PATCH(request: Request, context: RouteContext) {
  const { stallId } = await context.params;
  const authorization = await authorizeStallManagementApiRequest(
    request,
    stallId,
    "MANAGE_ATTENDANCE",
  );
  if (!authorization.ok) return authorization.response;
  const timezone = await getStallTimezone(stallId, authorization.workspace.id);
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: noStoreHeaders(authorization.requestId) },
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
  const parsed = attendanceManagerCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "打卡設定內容不正確。" },
      { status: 400, headers: noStoreHeaders(authorization.requestId) },
    );
  }

  try {
    if (parsed.data.operation === "UPDATE_POLICY") {
      await updateAttendancePolicy({
        organizationId: authorization.workspace.id,
        stallId,
        profileId: authorization.principal.user.id,
        command: parsed.data,
      });
    } else {
      await reviewAttendanceEvent({
        organizationId: authorization.workspace.id,
        stallId,
        eventId: parsed.data.eventId,
        reviewerProfileId: authorization.principal.user.id,
        decision: parsed.data.decision,
        note: parsed.data.note,
      });
    }
    await recordAuditEvent({
      organizationId: authorization.workspace.id,
      stallId,
      actorProfileId: authorization.principal.user.id,
      action: parsed.data.operation === "UPDATE_POLICY"
        ? "ATTENDANCE_POLICY_UPDATED"
        : "ATTENDANCE_EVENT_REVIEWED",
      entityType: parsed.data.operation === "UPDATE_POLICY"
        ? "ATTENDANCE_POLICY"
        : "ATTENDANCE_EVENT",
      entityId: parsed.data.operation === "UPDATE_POLICY" ? stallId : parsed.data.eventId,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      metadata: parsed.data.operation === "UPDATE_POLICY"
        ? {
          enabled: parsed.data.enabled,
          radiusMeters: parsed.data.radiusMeters,
          maxAccuracyMeters: parsed.data.maxAccuracyMeters,
          requireRotatingCode: parsed.data.requireRotatingCode,
        }
        : { decision: parsed.data.decision, note: parsed.data.note },
    });
    return NextResponse.json(
      await getAttendanceManagerSnapshot({
        organizationId: authorization.workspace.id,
        stallId,
        timezone,
      }),
      { headers: noStoreHeaders(authorization.requestId) },
    );
  } catch (error) {
    if (error instanceof AttendanceError && error.code === "EVENT_NOT_REVIEWABLE") {
      return NextResponse.json(
        { error: "這筆紀錄已覆核，或目前的上下班狀態不允許此決定。" },
        { status: 409, headers: noStoreHeaders(authorization.requestId) },
      );
    }
    throw error;
  }
}

function noStoreHeaders(requestId: string) {
  return { "cache-control": "private, no-store", "x-request-id": requestId };
}

async function getStallTimezone(stallId: string, organizationId: string) {
  return (await prisma.stall.findUnique({
    where: { id: stallId, organizationId },
    select: { timezone: true },
  }))?.timezone ?? "Asia/Taipei";
}
