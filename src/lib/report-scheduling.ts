import { z } from "zod";

export const reportScheduleTypes = ["DAILY_SALES", "WEEKLY_SALES", "PAYMENT_VARIANCE"] as const;
export type ScheduledReportType = (typeof reportScheduleTypes)[number];

const email = z.string().trim().email().max(254).transform((value) => value.toLowerCase());

export const reportScheduleInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  reportType: z.enum(reportScheduleTypes),
  recipients: z.array(email).min(1).max(20).refine((items) => new Set(items).size === items.length, "收件人不可重複。"),
  stallIds: z.array(z.string().uuid()).min(1).max(50).refine((items) => new Set(items).size === items.length, "攤位不可重複。"),
  timezone: z.string().trim().min(1).max(80).refine(isValidTimeZone, "時區不正確。"),
  sendHour: z.number().int().min(0).max(23),
  sendMinute: z.number().int().min(0).max(59),
  dayOfWeek: z.number().int().min(0).max(6).nullable(),
  isEnabled: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.reportType === "WEEKLY_SALES" && value.dayOfWeek === null) {
    context.addIssue({ code: "custom", path: ["dayOfWeek"], message: "週報必須指定寄送星期。" });
  }
  if (value.reportType !== "WEEKLY_SALES" && value.dayOfWeek !== null) {
    context.addIssue({ code: "custom", path: ["dayOfWeek"], message: "非週報不可指定寄送星期。" });
  }
});

export function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

type ScheduleTime = {
  reportType: ScheduledReportType;
  timezone: string;
  sendHour: number;
  sendMinute: number;
  dayOfWeek: number | null;
};

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  dayOfWeek: number;
};

const weekdayIndexes: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const parts = new Map(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.get("year")),
    month: Number(parts.get("month")),
    day: Number(parts.get("day")),
    hour: Number(parts.get("hour")),
    minute: Number(parts.get("minute")),
    second: Number(parts.get("second")),
    dayOfWeek: weekdayIndexes[parts.get("weekday") ?? "Sun"] ?? 0,
  };
}

function zonedDateTimeToUtc(parts: Omit<ZonedParts, "dayOfWeek" | "second">, timeZone: string) {
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
  let guess = target;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const current = zonedParts(new Date(guess), timeZone);
    const represented = Date.UTC(current.year, current.month - 1, current.day, current.hour, current.minute, 0, 0);
    const adjustment = represented - target;
    if (adjustment === 0) break;
    guess -= adjustment;
  }
  return new Date(guess);
}

function addLocalDays(parts: Pick<ZonedParts, "year" | "month" | "day">, days: number) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), dayOfWeek: date.getUTCDay() };
}

export function nextScheduledRun(schedule: ScheduleTime, after = new Date()) {
  if (!isValidTimeZone(schedule.timezone)) throw new Error("INVALID_TIMEZONE");
  const localNow = zonedParts(after, schedule.timezone);
  for (let offset = 0; offset <= 14; offset += 1) {
    const localDate = addLocalDays(localNow, offset);
    if (schedule.reportType === "WEEKLY_SALES" && localDate.dayOfWeek !== schedule.dayOfWeek) continue;
    const candidate = zonedDateTimeToUtc({
      year: localDate.year,
      month: localDate.month,
      day: localDate.day,
      hour: schedule.sendHour,
      minute: schedule.sendMinute,
    }, schedule.timezone);
    if (candidate.valueOf() > after.valueOf()) return candidate;
  }
  throw new Error("NEXT_RUN_NOT_FOUND");
}

export function reportPeriodForRun(reportType: ScheduledReportType, runAt: Date, timeZone: string) {
  const runDate = zonedParts(runAt, timeZone);
  const end = addLocalDays(runDate, -1);
  const start = addLocalDays(end, reportType === "WEEKLY_SALES" ? -6 : 0);
  return { periodStart: localDateString(start), periodEnd: localDateString(end) };
}

function localDateString(parts: Pick<ZonedParts, "year" | "month" | "day">) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export const reportScheduleTypeLabels: Record<ScheduledReportType, string> = {
  DAILY_SALES: "每日銷售日報",
  WEEKLY_SALES: "每週營運週報",
  PAYMENT_VARIANCE: "付款差異報告",
};
