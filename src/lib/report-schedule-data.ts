import "server-only";

import { prisma } from "@/lib/prisma";

export async function getReportScheduleManagementData(organizationId: string) {
  const schedules = await prisma.reportSchedule.findMany({
    where: { organizationId, archivedAt: null },
    include: {
      createdBy: { select: { displayName: true } },
      deliveries: { orderBy: { createdAt: "desc" }, take: 5 },
    },
    orderBy: [{ isEnabled: "desc" }, { nextRunAt: "asc" }],
  });
  return schedules.map((schedule) => ({
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
