import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { nextScheduledRun, reportScheduleInputSchema } from "@/lib/report-scheduling";
import { hashClientIp } from "@/lib/security";

type RouteContext = { params: Promise<{ organizationId: string; scheduleId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { organizationId, scheduleId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(request, organizationId, "MANAGE_REPORT_SCHEDULES");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json({ error: "安全驗證已失效，請重新整理後再試。" }, { status: 403, headers: { "x-request-id": authorization.requestId } });
  }
  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = reportScheduleInputSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "排程資料不正確。" }, { status: 400, headers: { "x-request-id": authorization.requestId } });
  }
  const schedule = await prisma.reportSchedule.findFirst({ where: { id: scheduleId, organizationId, archivedAt: null } });
  if (!schedule) return NextResponse.json({ error: "找不到指定排程。" }, { status: 404, headers: { "x-request-id": authorization.requestId } });
  const allowedStallIds = new Set(authorization.workspace.stalls.filter((stall) => stall.isActive).map((stall) => stall.id));
  if (parsed.data.stallIds.some((stallId) => !allowedStallIds.has(stallId))) {
    return NextResponse.json({ error: "攤位範圍包含未授權資源。" }, { status: 403, headers: { "x-request-id": authorization.requestId } });
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

export async function DELETE(request: Request, context: RouteContext) {
  const { organizationId, scheduleId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(request, organizationId, "MANAGE_REPORT_SCHEDULES");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json({ error: "安全驗證已失效，請重新整理後再試。" }, { status: 403, headers: { "x-request-id": authorization.requestId } });
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
