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

type RouteContext = { params: Promise<{ organizationId: string; scheduleId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { organizationId, scheduleId } = await context.params;
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
  const schedule = await prisma.reportSchedule.findFirst({ where: { id: scheduleId, organizationId, archivedAt: null } });
  if (!schedule) return NextResponse.json({ error: "找不到指定排程。" }, { status: 404, headers: { "x-request-id": authorization.requestId } });
  const allowedStallIds = new Set(authorization.workspace.stalls.filter((stall) => stall.isActive).map((stall) => stall.id));
  if (parsed.data.stallIds.some((stallId) => !allowedStallIds.has(stallId))) {
    const message = "攤位範圍包含未授權資源。";
    return NextResponse.json({ error: message, fieldErrors: { stallIds: message } }, { status: 403, headers: { "x-request-id": authorization.requestId } });
  }
  const nextRunAt = nextScheduledRun(parsed.data);
  const updated = await prisma.reportSchedule.update({
    where: { id: schedule.id },
    data: { ...parsed.data, nextRunAt, updatedById: authorization.principal.user.id },
  });
  await recordAuditEvent({
    organizationId,
    actorProfileId: authorization.principal.user.id,
    action: "REPORT_SCHEDULE_UPDATED",
    entityType: "REPORT_SCHEDULE",
    entityId: schedule.id,
    outcome: "SUCCESS",
    requestId: authorization.requestId,
    ipHash: hashClientIp(request),
    before: { reportType: schedule.reportType, stallCount: schedule.stallIds.length, recipientCount: schedule.recipients.length, isEnabled: schedule.isEnabled },
    after: { reportType: updated.reportType, stallCount: updated.stallIds.length, recipientCount: updated.recipients.length, isEnabled: updated.isEnabled },
  });
  return NextResponse.json({ schedule: { ...updated, nextRunAt: updated.nextRunAt.toISOString() } }, { headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } });
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

export async function DELETE(request: Request, context: RouteContext) {
  const { organizationId, scheduleId } = await context.params;
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
  const update = await prisma.reportSchedule.updateMany({
    where: { id: scheduleId, organizationId, archivedAt: null },
    data: { archivedAt: new Date(), isEnabled: false, updatedById: authorization.principal.user.id },
  });
  if (update.count !== 1) return NextResponse.json({ error: "找不到指定排程。" }, { status: 404, headers: { "x-request-id": authorization.requestId } });
  await recordAuditEvent({
    organizationId,
    actorProfileId: authorization.principal.user.id,
    action: "REPORT_SCHEDULE_ARCHIVED",
    entityType: "REPORT_SCHEDULE",
    entityId: scheduleId,
    outcome: "SUCCESS",
    requestId: authorization.requestId,
    ipHash: hashClientIp(request),
  });
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } });
}
