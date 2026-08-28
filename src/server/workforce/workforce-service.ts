import "server-only";

import { Prisma } from "@prisma/client";
import { calendarDateInTimeZone } from "@/lib/date-time";
import { prisma } from "@/lib/prisma";
import type { LeaveRequestCommand, WorkforceManagerCommand } from "@/server/workforce/workforce-contract";
import {
  calculatePayrollLines,
  type PayrollPolicyInput,
  type PayrollShiftInput,
} from "@/server/workforce/workforce-calculator";

const DEFAULT_POLICY: PayrollPolicyInput = {
  regularDayMinutes: 480,
  roundingIncrementMinutes: 1,
  overtimeTier1Minutes: 120,
  overtimeTier1MultiplierBps: 13_333,
  overtimeTier2MultiplierBps: 16_667,
  defaultHolidayMultiplierBps: 20_000,
};

export class WorkforceOperationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "WorkforceOperationError";
  }
}

export type WorkforceAccessScope = {
  canUseAllStalls: boolean;
  authorizedStallIds: readonly string[];
};

export async function getWorkforceDashboard(input: {
  organizationId: string;
  dateFrom: string;
  dateTo: string;
  accessScope: WorkforceAccessScope;
}) {
  assertDateRange(input.dateFrom, input.dateTo, 366);
  const from = new Date(`${input.dateFrom}T00:00:00.000Z`);
  const dayAfterTo = new Date(`${input.dateTo}T00:00:00.000Z`);
  dayAfterTo.setUTCDate(dayAfterTo.getUTCDate() + 1);
  const bufferFrom = new Date(from.getTime() - 24 * 60 * 60_000);
  const bufferTo = new Date(dayAfterTo.getTime() + 24 * 60 * 60_000);

  const restrictedStallIds = input.accessScope.canUseAllStalls
    ? null
    : [...new Set(input.accessScope.authorizedStallIds)];
  const stallScopeWhere = restrictedStallIds ? { stallId: { in: restrictedStallIds } } : {};

  const [
    policyRecord,
    stallMemberships,
    wageRates,
    schedules,
    leaveRequests,
    holidayRules,
    attendanceEvents,
    payrollPeriods,
  ] = await Promise.all([
    prisma.workforcePayrollPolicy.findUnique({ where: { organizationId: input.organizationId } }),
    prisma.stallMembership.findMany({
      where: {
        organizationId: input.organizationId,
        isActive: true,
        role: { in: ["STAFF", "KITCHEN", "STALL_MANAGER"] },
        profile: { isActive: true },
        stall: { isActive: true },
        ...stallScopeWhere,
      },
      select: {
        profileId: true,
        role: true,
        profile: { select: { displayName: true, email: true } },
        stall: { select: { id: true, name: true, timezone: true } },
      },
      orderBy: [{ profile: { displayName: "asc" } }, { stall: { name: "asc" } }],
    }),
    prisma.workforceWageRate.findMany({
      where: {
        organizationId: input.organizationId,
        AND: [
          {
            effectiveFrom: { lte: new Date(`${input.dateTo}T00:00:00.000Z`) },
            OR: [
              { effectiveTo: null },
              { effectiveTo: { gte: new Date(`${input.dateFrom}T00:00:00.000Z`) } },
            ],
          },
          ...(restrictedStallIds ? [{
            OR: [
              { stallId: null },
              { stallId: { in: restrictedStallIds } },
            ],
          }] : []),
        ],
      },
      orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    }),
    prisma.workforceSchedule.findMany({
      where: {
        organizationId: input.organizationId,
        workDate: { gte: from, lt: dayAfterTo },
        ...stallScopeWhere,
      },
      orderBy: [{ workDate: "asc" }, { shiftStartAt: "asc" }],
      take: 5_000,
    }),
    prisma.workforceLeaveRequest.findMany({
      where: {
        organizationId: input.organizationId,
        startDate: { lt: dayAfterTo },
        endDate: { gte: from },
        ...stallScopeWhere,
      },
      orderBy: [{ status: "asc" }, { startDate: "asc" }, { createdAt: "asc" }],
      take: 2_000,
    }),
    prisma.workforceHolidayRule.findMany({
      where: {
        organizationId: input.organizationId,
        holidayDate: { gte: from, lt: dayAfterTo },
      },
      orderBy: { holidayDate: "asc" },
    }),
    prisma.attendanceEvent.findMany({
      where: {
        organizationId: input.organizationId,
        decision: "ACCEPTED",
        occurredAt: { gte: bufferFrom, lt: bufferTo },
        ...stallScopeWhere,
      },
      select: {
        id: true,
        profileId: true,
        stallId: true,
        eventType: true,
        occurredAt: true,
        profile: { select: { displayName: true } },
        stall: { select: { name: true, timezone: true } },
      },
      orderBy: [{ profileId: "asc" }, { stallId: "asc" }, { occurredAt: "asc" }],
      take: 20_000,
    }),
    prisma.workforcePayrollPeriod.findMany({
      where: {
        organizationId: input.organizationId,
        ...(restrictedStallIds ? { id: { in: [] } } : {}),
      },
      orderBy: [{ periodEnd: "desc" }, { createdAt: "desc" }],
      take: 12,
    }),
  ]);

  const policy = policyRecord ? serializePolicy(policyRecord) : DEFAULT_POLICY;
  const employeeMap = new Map<string, {
    profileId: string;
    displayName: string;
    email: string | null;
    assignments: Array<{ stallId: string; stallName: string; role: string; timezone: string }>;
  }>();
  for (const membership of stallMemberships) {
    const employee = employeeMap.get(membership.profileId) ?? {
      profileId: membership.profileId,
      displayName: membership.profile.displayName,
      email: membership.profile.email,
      assignments: [],
    };
    employee.assignments.push({
      stallId: membership.stall.id,
      stallName: membership.stall.name,
      role: membership.role,
      timezone: membership.stall.timezone,
    });
    employeeMap.set(membership.profileId, employee);
  }

  const scheduleByKey = new Map<string, typeof schedules[number]>();
  for (const schedule of schedules) {
    if (schedule.status === "PUBLISHED") {
      scheduleByKey.set(
        `${schedule.profileId}:${schedule.stallId}:${dateOnly(schedule.workDate)}`,
        schedule,
      );
    }
  }
  const holidayByDate = new Map(holidayRules.map((rule) => [dateOnly(rule.holidayDate), rule]));
  const { shifts, anomalies } = buildPayrollShifts({
    events: attendanceEvents,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    schedules: scheduleByKey,
    holidays: holidayByDate,
    wageRates,
  });
  const payrollPreview = calculatePayrollLines(shifts, policy);
  const profileNames = new Map([...employeeMap.values()].map((employee) => [employee.profileId, employee.displayName]));

  return {
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    policy,
    employees: [...employeeMap.values()].map((employee) => ({
      ...employee,
      currentWageRates: wageRates
        .filter((rate) => rate.profileId === employee.profileId)
        .map(serializeWageRate),
    })),
    schedules: schedules.map((schedule) => ({
      id: schedule.id,
      profileId: schedule.profileId,
      profileName: profileNames.get(schedule.profileId) ?? "未知員工",
      stallId: schedule.stallId,
      workDate: dateOnly(schedule.workDate),
      shiftStartAt: schedule.shiftStartAt?.toISOString() ?? null,
      shiftEndAt: schedule.shiftEndAt?.toISOString() ?? null,
      unpaidBreakMinutes: schedule.unpaidBreakMinutes,
      dayType: schedule.dayType,
      status: schedule.status,
      note: schedule.note,
    })),
    leaveRequests: leaveRequests.map((request) => ({
      id: request.id,
      profileId: request.profileId,
      profileName: profileNames.get(request.profileId) ?? "未知員工",
      stallId: request.stallId,
      leaveType: request.leaveType,
      startDate: dateOnly(request.startDate),
      endDate: dateOnly(request.endDate),
      reason: request.reason,
      status: request.status,
      reviewNote: request.reviewNote,
      createdAt: request.createdAt.toISOString(),
    })),
    holidayRules: holidayRules.map((rule) => ({
      id: rule.id,
      holidayDate: dateOnly(rule.holidayDate),
      name: rule.name,
      multiplierBps: rule.multiplierBps,
      note: rule.note,
    })),
    payrollPreview,
    anomalies,
    payrollPeriods: await serializePayrollPeriods(input.organizationId, payrollPeriods, profileNames),
    totals: {
      payableMinutes: payrollPreview.reduce((sum, line) => sum + line.regularMinutes + line.overtimeTier1Minutes + line.overtimeTier2Minutes + line.holidayMinutes, 0),
      grossAmount: payrollPreview.reduce((sum, line) => sum + line.grossAmount, 0),
      pendingLeaveCount: leaveRequests.filter((request) => request.status === "PENDING").length,
      missingWageRateCount: payrollPreview.filter((line) => line.missingWageRate).length,
    },
  };
}

export async function applyWorkforceManagerCommand(input: {
  organizationId: string;
  actorProfileId: string;
  command: WorkforceManagerCommand;
  accessScope: WorkforceAccessScope;
}) {
  assertWorkforceCommandAccess(input.command, input.accessScope);
  switch (input.command.operation) {
    case "UPDATE_POLICY":
      return prisma.workforcePayrollPolicy.upsert({
        where: { organizationId: input.organizationId },
        create: {
          organizationId: input.organizationId,
          ...policyData(input.command),
          updatedByProfileId: input.actorProfileId,
        },
        update: { ...policyData(input.command), updatedByProfileId: input.actorProfileId },
      });
    case "SET_WAGE_RATE":
      return setWageRate({ ...input, command: input.command });
    case "CREATE_SCHEDULE":
      return createSchedule({ ...input, command: input.command });
    case "CANCEL_SCHEDULE":
      return cancelSchedule({ ...input, command: input.command });
    case "UPSERT_HOLIDAY":
      return prisma.workforceHolidayRule.upsert({
        where: {
          organizationId_holidayDate: {
            organizationId: input.organizationId,
            holidayDate: new Date(`${input.command.holidayDate}T00:00:00.000Z`),
          },
        },
        create: {
          organizationId: input.organizationId,
          holidayDate: new Date(`${input.command.holidayDate}T00:00:00.000Z`),
          name: input.command.name,
          multiplierBps: input.command.multiplierBps,
          note: input.command.note ?? null,
          createdByProfileId: input.actorProfileId,
        },
        update: {
          name: input.command.name,
          multiplierBps: input.command.multiplierBps,
          note: input.command.note ?? null,
        },
      });
    case "REVIEW_LEAVE":
      return reviewLeaveRequest({ ...input, command: input.command });
    case "CANCEL_LEAVE":
      return cancelLeaveRequest({ ...input, command: input.command });
    case "GENERATE_PAYROLL":
      return generatePayrollPeriod({ ...input, command: input.command });
    case "FINALIZE_PAYROLL":
      return finalizePayrollPeriod({ ...input, command: input.command });
  }
}

export async function getEmployeeWorkforceSnapshot(input: {
  organizationId: string;
  stallId: string;
  profileId: string;
}) {
  const today = new Date();
  const end = new Date(today);
  end.setUTCDate(end.getUTCDate() + 31);
  const [schedules, leaveRequests] = await Promise.all([
    prisma.workforceSchedule.findMany({
      where: {
        organizationId: input.organizationId,
        stallId: input.stallId,
        profileId: input.profileId,
        workDate: { gte: new Date(today.toISOString().slice(0, 10)), lt: end },
        status: { not: "CANCELLED" },
      },
      orderBy: [{ workDate: "asc" }, { shiftStartAt: "asc" }],
      take: 60,
    }),
    prisma.workforceLeaveRequest.findMany({
      where: {
        organizationId: input.organizationId,
        stallId: input.stallId,
        profileId: input.profileId,
        endDate: { gte: new Date(today.toISOString().slice(0, 10)) },
      },
      orderBy: [{ startDate: "asc" }, { createdAt: "desc" }],
      take: 50,
    }),
  ]);
  return {
    schedules: schedules.map((schedule) => ({
      id: schedule.id,
      workDate: dateOnly(schedule.workDate),
      shiftStartAt: schedule.shiftStartAt?.toISOString() ?? null,
      shiftEndAt: schedule.shiftEndAt?.toISOString() ?? null,
      unpaidBreakMinutes: schedule.unpaidBreakMinutes,
      dayType: schedule.dayType,
      status: schedule.status,
      note: schedule.note,
    })),
    leaveRequests: leaveRequests.map((request) => ({
      id: request.id,
      leaveType: request.leaveType,
      startDate: dateOnly(request.startDate),
      endDate: dateOnly(request.endDate),
      reason: request.reason,
      status: request.status,
      reviewNote: request.reviewNote,
    })),
  };
}

export async function createEmployeeLeaveRequest(input: {
  organizationId: string;
  stallId: string;
  profileId: string;
  command: Extract<LeaveRequestCommand, { operation: "CREATE_LEAVE_REQUEST" }>;
}) {
  assertDateRange(input.command.startDate, input.command.endDate, 31);
  const membership = await prisma.stallMembership.findFirst({
    where: {
      organizationId: input.organizationId,
      stallId: input.stallId,
      profileId: input.profileId,
      isActive: true,
    },
    select: { id: true },
  });
  if (!membership) throw new WorkforceOperationError("WORKFORCE_EMPLOYEE_NOT_FOUND");
  const startDate = new Date(`${input.command.startDate}T00:00:00.000Z`);
  const endDate = new Date(`${input.command.endDate}T00:00:00.000Z`);
  const overlap = await prisma.workforceLeaveRequest.findFirst({
    where: {
      organizationId: input.organizationId,
      stallId: input.stallId,
      profileId: input.profileId,
      status: { in: ["PENDING", "APPROVED"] },
      startDate: { lte: endDate },
      endDate: { gte: startDate },
    },
    select: { id: true },
  });
  if (overlap) throw new WorkforceOperationError("WORKFORCE_LEAVE_OVERLAP");
  return prisma.workforceLeaveRequest.create({
    data: {
      organizationId: input.organizationId,
      stallId: input.stallId,
      profileId: input.profileId,
      leaveType: input.command.leaveType,
      startDate,
      endDate,
      reason: input.command.reason ?? null,
      requestedByProfileId: input.profileId,
    },
  });
}

export async function cancelEmployeeLeaveRequest(input: {
  organizationId: string;
  stallId: string;
  profileId: string;
  command: Extract<LeaveRequestCommand, { operation: "CANCEL_LEAVE_REQUEST" }>;
}) {
  const result = await prisma.workforceLeaveRequest.updateMany({
    where: {
      id: input.command.leaveRequestId,
      organizationId: input.organizationId,
      stallId: input.stallId,
      profileId: input.profileId,
      status: "PENDING",
    },
    data: { status: "CANCELLED" },
  });
  if (result.count !== 1) throw new WorkforceOperationError("WORKFORCE_LEAVE_NOT_CANCELLABLE");
  return { id: input.command.leaveRequestId };
}

function buildPayrollShifts(input: {
  events: Array<{
    id: string;
    profileId: string;
    stallId: string;
    eventType: string;
    occurredAt: Date;
    profile: { displayName: string };
    stall: { name: string; timezone: string };
  }>;
  dateFrom: string;
  dateTo: string;
  schedules: Map<string, { unpaidBreakMinutes: number; dayType: string }>;
  holidays: Map<string, { multiplierBps: number }>;
  wageRates: Array<{
    profileId: string;
    stallId: string | null;
    hourlyRate: number;
    effectiveFrom: Date;
    effectiveTo: Date | null;
  }>;
}) {
  const grouped = new Map<string, typeof input.events>();
  for (const event of input.events) {
    const key = `${event.profileId}:${event.stallId}`;
    grouped.set(key, [...(grouped.get(key) ?? []), event]);
  }
  const shifts: PayrollShiftInput[] = [];
  const anomalies: Array<{ profileId: string; profileName: string; stallName: string; message: string; occurredAt: string }> = [];
  for (const events of grouped.values()) {
    let open: typeof events[number] | null = null;
    for (const event of events) {
      if (event.eventType === "CLOCK_IN") {
        if (open) anomalies.push(anomaly(open, "重複上班打卡，前一筆沒有配對下班。"));
        open = event;
        continue;
      }
      if (!open) {
        anomalies.push(anomaly(event, "下班打卡沒有配對的上班紀錄。"));
        continue;
      }
      const clockIn = open;
      open = null;
      const workDate = calendarDateInTimeZone(clockIn.occurredAt, clockIn.stall.timezone);
      if (workDate < input.dateFrom || workDate > input.dateTo) continue;
      const workedMinutes = Math.max(0, Math.round((event.occurredAt.getTime() - clockIn.occurredAt.getTime()) / 60_000));
      if (workedMinutes > 16 * 60) anomalies.push(anomaly(clockIn, "單次工時超過 16 小時，請覆核。"));
      const schedule = input.schedules.get(`${clockIn.profileId}:${clockIn.stallId}:${workDate}`);
      const holiday = input.holidays.get(workDate);
      const wageRate = resolveWageRate(input.wageRates, clockIn.profileId, clockIn.stallId, workDate);
      shifts.push({
        id: `${clockIn.id}:${event.id}`,
        profileId: clockIn.profileId,
        profileName: clockIn.profile.displayName,
        stallId: clockIn.stallId,
        stallName: clockIn.stall.name,
        workDate,
        workedMinutes,
        unpaidBreakMinutes: schedule?.unpaidBreakMinutes ?? 0,
        dayType: holiday ? "NATIONAL_HOLIDAY" : normalizeDayType(schedule?.dayType),
        holidayMultiplierBps: holiday?.multiplierBps,
        hourlyRate: wageRate?.hourlyRate ?? null,
      });
    }
    if (open) anomalies.push(anomaly(open, "上班打卡尚未有下班紀錄。"));
  }
  return { shifts, anomalies };
}

function resolveWageRate(
  rates: Array<{ profileId: string; stallId: string | null; hourlyRate: number; effectiveFrom: Date; effectiveTo: Date | null }>,
  profileId: string,
  stallId: string,
  workDate: string,
) {
  return rates
    .filter((rate) => rate.profileId === profileId
      && (rate.stallId === stallId || rate.stallId === null)
      && dateOnly(rate.effectiveFrom) <= workDate
      && (!rate.effectiveTo || dateOnly(rate.effectiveTo) >= workDate))
    .sort((left, right) => {
      if (Boolean(left.stallId) !== Boolean(right.stallId)) return left.stallId ? -1 : 1;
      return right.effectiveFrom.getTime() - left.effectiveFrom.getTime();
    })[0];
}

async function setWageRate(input: {
  organizationId: string;
  actorProfileId: string;
  command: Extract<WorkforceManagerCommand, { operation: "SET_WAGE_RATE" }>;
}) {
  await assertEmployeeAndStall(input.organizationId, input.command.profileId, input.command.stallId ?? null);
  const effectiveFrom = new Date(`${input.command.effectiveFrom}T00:00:00.000Z`);
  const existing = await prisma.workforceWageRate.findFirst({
    where: {
      organizationId: input.organizationId,
      profileId: input.command.profileId,
      stallId: input.command.stallId ?? null,
      effectiveFrom,
    },
  });
  const data = {
    hourlyRate: input.command.hourlyRate,
    effectiveTo: input.command.effectiveTo ? new Date(`${input.command.effectiveTo}T00:00:00.000Z`) : null,
    note: input.command.note ?? null,
  };
  return existing
    ? prisma.workforceWageRate.update({ where: { id: existing.id }, data })
    : prisma.workforceWageRate.create({
      data: {
        organizationId: input.organizationId,
        profileId: input.command.profileId,
        stallId: input.command.stallId ?? null,
        effectiveFrom,
        createdByProfileId: input.actorProfileId,
        ...data,
      },
    });
}

async function createSchedule(input: {
  organizationId: string;
  actorProfileId: string;
  command: Extract<WorkforceManagerCommand, { operation: "CREATE_SCHEDULE" }>;
}) {
  await assertEmployeeAndStall(input.organizationId, input.command.profileId, input.command.stallId);
  return prisma.workforceSchedule.create({
    data: {
      organizationId: input.organizationId,
      stallId: input.command.stallId,
      profileId: input.command.profileId,
      workDate: new Date(`${input.command.workDate}T00:00:00.000Z`),
      shiftStartAt: input.command.shiftStartAt ? new Date(input.command.shiftStartAt) : null,
      shiftEndAt: input.command.shiftEndAt ? new Date(input.command.shiftEndAt) : null,
      unpaidBreakMinutes: input.command.unpaidBreakMinutes,
      dayType: input.command.dayType,
      status: input.command.status,
      note: input.command.note ?? null,
      createdByProfileId: input.actorProfileId,
    },
  });
}

async function cancelSchedule(input: {
  organizationId: string;
  actorProfileId: string;
  command: Extract<WorkforceManagerCommand, { operation: "CANCEL_SCHEDULE" }>;
  accessScope: WorkforceAccessScope;
}) {
  const result = await prisma.workforceSchedule.updateMany({
    where: {
      id: input.command.scheduleId,
      organizationId: input.organizationId,
      status: { not: "CANCELLED" },
      ...restrictedStallWhere(input.accessScope),
    },
    data: { status: "CANCELLED", note: "由排班主管取消" },
  });
  if (result.count !== 1) throw new WorkforceOperationError("WORKFORCE_SCHEDULE_NOT_CANCELLABLE");
  return { id: input.command.scheduleId };
}

async function reviewLeaveRequest(input: {
  organizationId: string;
  actorProfileId: string;
  command: Extract<WorkforceManagerCommand, { operation: "REVIEW_LEAVE" }>;
  accessScope: WorkforceAccessScope;
}) {
  const result = await prisma.workforceLeaveRequest.updateMany({
    where: {
      id: input.command.leaveRequestId,
      organizationId: input.organizationId,
      status: "PENDING",
      ...restrictedStallWhere(input.accessScope),
    },
    data: {
      status: input.command.decision,
      reviewNote: input.command.reviewNote ?? null,
      reviewedByProfileId: input.actorProfileId,
      reviewedAt: new Date(),
    },
  });
  if (result.count !== 1) throw new WorkforceOperationError("WORKFORCE_LEAVE_NOT_REVIEWABLE");
  return { id: input.command.leaveRequestId };
}

async function cancelLeaveRequest(input: {
  organizationId: string;
  actorProfileId: string;
  command: Extract<WorkforceManagerCommand, { operation: "CANCEL_LEAVE" }>;
  accessScope: WorkforceAccessScope;
}) {
  const result = await prisma.workforceLeaveRequest.updateMany({
    where: {
      id: input.command.leaveRequestId,
      organizationId: input.organizationId,
      status: { in: ["PENDING", "APPROVED"] },
      ...restrictedStallWhere(input.accessScope),
    },
    data: {
      status: "CANCELLED",
      reviewNote: input.command.reviewNote ?? "由排班主管取消",
      reviewedByProfileId: input.actorProfileId,
      reviewedAt: new Date(),
    },
  });
  if (result.count !== 1) throw new WorkforceOperationError("WORKFORCE_LEAVE_NOT_CANCELLABLE");
  return { id: input.command.leaveRequestId };
}

async function generatePayrollPeriod(input: {
  organizationId: string;
  actorProfileId: string;
  command: Extract<WorkforceManagerCommand, { operation: "GENERATE_PAYROLL" }>;
  accessScope: WorkforceAccessScope;
}) {
  assertDateRange(input.command.periodStart, input.command.periodEnd, 62);
  const dashboard = await getWorkforceDashboard({
    organizationId: input.organizationId,
    dateFrom: input.command.periodStart,
    dateTo: input.command.periodEnd,
    accessScope: input.accessScope,
  });
  if (dashboard.payrollPreview.some((line) => line.missingWageRate)) {
    throw new WorkforceOperationError("WORKFORCE_WAGE_RATE_MISSING");
  }
  return prisma.$transaction(async (transaction) => {
    const periodStart = new Date(`${input.command.periodStart}T00:00:00.000Z`);
    const periodEnd = new Date(`${input.command.periodEnd}T00:00:00.000Z`);
    const existing = await transaction.workforcePayrollPeriod.findUnique({
      where: {
        organizationId_periodStart_periodEnd: {
          organizationId: input.organizationId,
          periodStart,
          periodEnd,
        },
      },
    });
    if (existing?.status === "FINALIZED") throw new WorkforceOperationError("WORKFORCE_PAYROLL_FINALIZED");
    const period = existing ?? await transaction.workforcePayrollPeriod.create({
      data: {
        organizationId: input.organizationId,
        periodStart,
        periodEnd,
        generatedByProfileId: input.actorProfileId,
      },
    });
    await transaction.workforcePayrollLine.deleteMany({ where: { payrollPeriodId: period.id } });
    if (dashboard.payrollPreview.length) {
      await transaction.workforcePayrollLine.createMany({
        data: dashboard.payrollPreview.map((line) => ({
          organizationId: input.organizationId,
          payrollPeriodId: period.id,
          profileId: line.profileId,
          hourlyRate: line.hourlyRate,
          regularMinutes: line.regularMinutes,
          overtimeTier1Minutes: line.overtimeTier1Minutes,
          overtimeTier2Minutes: line.overtimeTier2Minutes,
          holidayMinutes: line.holidayMinutes,
          regularAmount: line.regularAmount,
          overtimeAmount: line.overtimeAmount,
          holidayAmount: line.holidayAmount,
          grossAmount: line.grossAmount,
          calculationSnapshot: {
            generatedAt: new Date().toISOString(),
            policy: dashboard.policy,
            shifts: line.shifts,
            warnings: dashboard.anomalies.filter((warning) => warning.profileId === line.profileId),
          },
        })),
      });
    }
    return period;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function finalizePayrollPeriod(input: {
  organizationId: string;
  actorProfileId: string;
  command: Extract<WorkforceManagerCommand, { operation: "FINALIZE_PAYROLL" }>;
}) {
  const lineCount = await prisma.workforcePayrollLine.count({
    where: {
      organizationId: input.organizationId,
      payrollPeriodId: input.command.payrollPeriodId,
    },
  });
  if (!lineCount) throw new WorkforceOperationError("WORKFORCE_PAYROLL_EMPTY");
  const updated = await prisma.workforcePayrollPeriod.updateMany({
    where: {
      id: input.command.payrollPeriodId,
      organizationId: input.organizationId,
      status: "DRAFT",
    },
    data: {
      status: "FINALIZED",
      finalizedByProfileId: input.actorProfileId,
      finalizedAt: new Date(),
    },
  });
  if (updated.count !== 1) throw new WorkforceOperationError("WORKFORCE_PAYROLL_NOT_FINALIZABLE");
  return { id: input.command.payrollPeriodId };
}

async function assertEmployeeAndStall(organizationId: string, profileId: string, stallId: string | null) {
  const [membership, stall] = await Promise.all([
    prisma.stallMembership.findFirst({
      where: {
        organizationId,
        profileId,
        isActive: true,
        ...(stallId ? { stallId } : {}),
      },
      select: { id: true },
    }),
    stallId ? prisma.stall.findFirst({
      where: { organizationId, id: stallId, isActive: true },
      select: { id: true },
    }) : Promise.resolve({ id: "organization-wide" }),
  ]);
  if (!membership) throw new WorkforceOperationError("WORKFORCE_EMPLOYEE_NOT_FOUND");
  if (!stall) throw new WorkforceOperationError("WORKFORCE_STALL_NOT_FOUND");
}

function assertWorkforceCommandAccess(command: WorkforceManagerCommand, scope: WorkforceAccessScope) {
  if (scope.canUseAllStalls) return;
  const organizationWide = command.operation === "UPDATE_POLICY"
    || command.operation === "UPSERT_HOLIDAY"
    || command.operation === "GENERATE_PAYROLL"
    || command.operation === "FINALIZE_PAYROLL"
    || (command.operation === "SET_WAGE_RATE" && !command.stallId);
  if (organizationWide) throw new WorkforceOperationError("WORKFORCE_SCOPE_DENIED");
  if (
    (command.operation === "SET_WAGE_RATE" || command.operation === "CREATE_SCHEDULE")
    && !scope.authorizedStallIds.includes(command.stallId ?? "")
  ) {
    throw new WorkforceOperationError("WORKFORCE_SCOPE_DENIED");
  }
}

function restrictedStallWhere(scope: WorkforceAccessScope) {
  return scope.canUseAllStalls ? {} : { stallId: { in: [...scope.authorizedStallIds] } };
}

async function serializePayrollPeriods(
  organizationId: string,
  periods: Array<{ id: string; periodStart: Date; periodEnd: Date; status: string; generatedAt: Date; finalizedAt: Date | null }>,
  profileNames: Map<string, string>,
) {
  if (!periods.length) return [];
  const lines = await prisma.workforcePayrollLine.findMany({
    where: { organizationId, payrollPeriodId: { in: periods.map((period) => period.id) } },
    orderBy: [{ payrollPeriodId: "asc" }, { grossAmount: "desc" }],
  });
  return periods.map((period) => ({
    id: period.id,
    periodStart: dateOnly(period.periodStart),
    periodEnd: dateOnly(period.periodEnd),
    status: period.status,
    generatedAt: period.generatedAt.toISOString(),
    finalizedAt: period.finalizedAt?.toISOString() ?? null,
    totalGrossAmount: lines.filter((line) => line.payrollPeriodId === period.id).reduce((sum, line) => sum + line.grossAmount, 0),
    lines: lines.filter((line) => line.payrollPeriodId === period.id).map((line) => ({
      id: line.id,
      profileId: line.profileId,
      profileName: profileNames.get(line.profileId) ?? "未知員工",
      hourlyRate: line.hourlyRate,
      regularMinutes: line.regularMinutes,
      overtimeMinutes: line.overtimeTier1Minutes + line.overtimeTier2Minutes,
      holidayMinutes: line.holidayMinutes,
      grossAmount: line.grossAmount,
    })),
  }));
}

function policyData(command: Extract<WorkforceManagerCommand, { operation: "UPDATE_POLICY" }>) {
  return {
    regularDayMinutes: command.regularDayMinutes,
    roundingIncrementMinutes: command.roundingIncrementMinutes,
    overtimeTier1Minutes: command.overtimeTier1Minutes,
    overtimeTier1MultiplierBps: command.overtimeTier1MultiplierBps,
    overtimeTier2MultiplierBps: command.overtimeTier2MultiplierBps,
    defaultHolidayMultiplierBps: command.defaultHolidayMultiplierBps,
  };
}

function serializePolicy(policy: {
  regularDayMinutes: number;
  roundingIncrementMinutes: number;
  overtimeTier1Minutes: number;
  overtimeTier1MultiplierBps: number;
  overtimeTier2MultiplierBps: number;
  defaultHolidayMultiplierBps: number;
}) {
  return {
    regularDayMinutes: policy.regularDayMinutes,
    roundingIncrementMinutes: policy.roundingIncrementMinutes,
    overtimeTier1Minutes: policy.overtimeTier1Minutes,
    overtimeTier1MultiplierBps: policy.overtimeTier1MultiplierBps,
    overtimeTier2MultiplierBps: policy.overtimeTier2MultiplierBps,
    defaultHolidayMultiplierBps: policy.defaultHolidayMultiplierBps,
  };
}

function serializeWageRate(rate: {
  id: string;
  stallId: string | null;
  hourlyRate: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  note: string | null;
}) {
  return {
    id: rate.id,
    stallId: rate.stallId,
    hourlyRate: rate.hourlyRate,
    effectiveFrom: dateOnly(rate.effectiveFrom),
    effectiveTo: rate.effectiveTo ? dateOnly(rate.effectiveTo) : null,
    note: rate.note,
  };
}

function normalizeDayType(value: string | undefined): PayrollShiftInput["dayType"] {
  return value === "REST_DAY" || value === "REGULAR_DAY_OFF" || value === "NATIONAL_HOLIDAY"
    ? value
    : "WORKDAY";
}

function anomaly(event: {
  profileId: string;
  occurredAt: Date;
  profile: { displayName: string };
  stall: { name: string };
}, message: string) {
  return {
    profileId: event.profileId,
    profileName: event.profile.displayName,
    stallName: event.stall.name,
    message,
    occurredAt: event.occurredAt.toISOString(),
  };
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function assertDateRange(dateFrom: string, dateTo: string, maxDays: number) {
  const from = new Date(`${dateFrom}T00:00:00.000Z`);
  const to = new Date(`${dateTo}T00:00:00.000Z`);
  if (Number.isNaN(from.valueOf()) || Number.isNaN(to.valueOf()) || dateTo < dateFrom) {
    throw new WorkforceOperationError("WORKFORCE_DATE_RANGE_INVALID");
  }
  const days = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (days > maxDays) throw new WorkforceOperationError("WORKFORCE_DATE_RANGE_TOO_LARGE");
}
