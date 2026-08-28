import "server-only";

import { prisma } from "@/lib/prisma";
import { canAccessReportSchedule, type ReportScheduleAccessScope } from "@/lib/report-schedule-access";

export async function getReportScheduleManagementData(input: {
  organizationId: string;
  accessScope: ReportScheduleAccessScope;
}) {
  const restrictedStallIds = input.accessScope.canUseAllStalls
    ? null
    : [...new Set(input.accessScope.authorizedStallIds)];
  const schedules = await prisma.reportSchedule.findMany({
    where: {
      organizationId: input.organizationId,
      archivedAt: null,
      ...(restrictedStallIds ? { stallIds: { hasSome: restrictedStallIds } } : {}),
    },
    include: {
      createdBy: { select: { displayName: true } },
      deliveries: { orderBy: { createdAt: "desc" }, take: 5 },
    },
    orderBy: [{ isEnabled: "desc" }, { nextRunAt: "asc" }],
  });
  return schedules
    .filter((schedule) => canAccessReportSchedule(schedule.stallIds, input.accessScope))
    .map((schedule) => ({
    id: schedule.id,
    name: schedule.name,
    reportType: schedule.reportType,
    recipients: schedule.recipients,
    stallIds: schedule.stallIds,
    timezone: schedule.timezone,
    sendHour: schedule.sendHour,
    sendMinute: schedule.sendMinute,
    dayOfWeek: schedule.dayOfWeek,
    isEnabled: schedule.isEnabled,
    nextRunAt: schedule.nextRunAt.toISOString(),
    lastRunAt: schedule.lastRunAt?.toISOString() ?? null,
    createdByName: schedule.createdBy.displayName,
    deliveries: schedule.deliveries.map((delivery) => ({
      id: delivery.id,
      status: delivery.status,
      subject: delivery.subject,
      periodStart: delivery.periodStart.toISOString().slice(0, 10),
      periodEnd: delivery.periodEnd.toISOString().slice(0, 10),
      recipientCount: delivery.recipients.length,
      errorCode: delivery.errorCode,
      sentAt: delivery.sentAt?.toISOString() ?? null,
      createdAt: delivery.createdAt.toISOString(),
    })),
    }));
}

export function reportDeliveryMode() {
  if (process.env.REPORT_DELIVERY_MODE === "simulate") return "SIMULATED" as const;
  if (process.env.RESEND_API_KEY?.trim() && process.env.REPORT_FROM_EMAIL?.trim()) return "CONFIGURED" as const;
  return process.env.NODE_ENV === "production" ? "MISSING" as const : "SIMULATED" as const;
}
