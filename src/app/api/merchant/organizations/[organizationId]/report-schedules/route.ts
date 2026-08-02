import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { getZodFieldErrors } from "@/lib/form-field-errors";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { nextScheduledRun, reportScheduleInputSchema } from "@/lib/report-scheduling";
import { hashClientIp } from "@/lib/security";
import { entitlementErrorResponse } from "@/server/billing/entitlement-http";
import { entitlementService } from "@/server/billing/entitlement-service";

type RouteContext = { params: Promise<{ organizationId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(request, organizationId, "MANAGE_REPORT_SCHEDULES");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json({ error: "安全驗證已失效，請重新整理後再試。" }, { status: 403, headers: { "x-request-id": authorization.requestId } });
  }
  try {
    await entitlementService.assertFeatureEnabled(organizationId, "SCHEDULED_REPORTS");
  } catch (error) {
    const response = entitlementErrorResponse(error, authorization.requestId);
    if (response) return response;
    throw error;
  }
  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = reportScheduleInputSchema.safeParse(body.data);
  if (!parsed.success) {
    const fieldErrors = getZodFieldErrors(parsed.error, reportScheduleFieldLabels);
    return NextResponse.json({ error: "排程資料不正確，請檢查標示欄位。", fieldErrors }, { status: 400, headers: { "x-request-id": authorization.requestId } });
  }
  const allowedStallIds = new Set(authorization.workspace.stalls.filter((stall) => stall.isActive).map((stall) => stall.id));
  if (parsed.data.stallIds.some((stallId) => !allowedStallIds.has(stallId))) {
    const message = "攤位範圍包含未授權資源。";
    return NextResponse.json({ error: message, fieldErrors: { stallIds: message } }, { status: 403, headers: { "x-request-id": authorization.requestId } });
  }
  const nextRunAt = nextScheduledRun(parsed.data);
  const schedule = await prisma.reportSchedule.create({
    data: {
      organizationId,
      ...parsed.data,
      nextRunAt,
      createdById: authorization.principal.user.id,
      updatedById: authorization.principal.user.id,
    },
  });
  await recordAuditEvent({
    organizationId,
    actorProfileId: authorization.principal.user.id,
    action: "REPORT_SCHEDULE_CREATED",
    entityType: "REPORT_SCHEDULE",
    entityId: schedule.id,
    outcome: "SUCCESS",
    requestId: authorization.requestId,
    ipHash: hashClientIp(request),
    after: { reportType: schedule.reportType, stallCount: schedule.stallIds.length, recipientCount: schedule.recipients.length, isEnabled: schedule.isEnabled },
  });
  return NextResponse.json({ schedule: serializeSchedule(schedule) }, { status: 201, headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } });
}

const reportScheduleFieldLabels = {
  name: "排程名稱",
  reportType: "報告類型",
  recipients: "收件人 Email",
  stallIds: "攤位範圍",
  timezone: "時區",
  sendHour: "寄送時間",
  sendMinute: "寄送時間",
  dayOfWeek: "寄送星期",
  isEnabled: "啟用排程",
};

function serializeSchedule(schedule: { id: string; nextRunAt: Date; createdAt: Date; updatedAt: Date }) {
  return { ...schedule, nextRunAt: schedule.nextRunAt.toISOString(), createdAt: schedule.createdAt.toISOString(), updatedAt: schedule.updatedAt.toISOString() };
}
