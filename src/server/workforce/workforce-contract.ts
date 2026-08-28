import { z } from "zod";

const uuid = z.string().uuid();
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式不正確");
const optionalNote = z.string().trim().max(500).nullable().optional();

const updatePolicy = z.object({
  operation: z.literal("UPDATE_POLICY"),
  regularDayMinutes: z.number().int().min(60).max(720),
  roundingIncrementMinutes: z.union([
    z.literal(1), z.literal(5), z.literal(10), z.literal(15), z.literal(30),
  ]),
  overtimeTier1Minutes: z.number().int().min(0).max(360),
  overtimeTier1MultiplierBps: z.number().int().min(10_000).max(50_000),
  overtimeTier2MultiplierBps: z.number().int().min(10_000).max(50_000),
  defaultHolidayMultiplierBps: z.number().int().min(10_000).max(50_000),
}).strict();

const setWageRate = z.object({
  operation: z.literal("SET_WAGE_RATE"),
  profileId: uuid,
  stallId: uuid.nullable().optional(),
  hourlyRate: z.number().int().min(1).max(1_000_000),
  effectiveFrom: calendarDate,
  effectiveTo: calendarDate.nullable().optional(),
  note: z.string().trim().max(300).nullable().optional(),
}).strict().refine(
  (value) => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom,
  { path: ["effectiveTo"], message: "結束日不得早於生效日" },
);

const createSchedule = z.object({
  operation: z.literal("CREATE_SCHEDULE"),
  profileId: uuid,
  stallId: uuid,
  workDate: calendarDate,
  shiftStartAt: z.string().datetime({ offset: true }).nullable().optional(),
  shiftEndAt: z.string().datetime({ offset: true }).nullable().optional(),
  unpaidBreakMinutes: z.number().int().min(0).max(480).default(0),
  dayType: z.enum(["WORKDAY", "REST_DAY", "REGULAR_DAY_OFF", "NATIONAL_HOLIDAY"]),
  status: z.enum(["DRAFT", "PUBLISHED", "CANCELLED"]).default("PUBLISHED"),
  note: z.string().trim().max(300).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (Boolean(value.shiftStartAt) !== Boolean(value.shiftEndAt)) {
    context.addIssue({ code: "custom", path: ["shiftEndAt"], message: "上班與下班時間需同時填寫" });
  }
  if (value.shiftStartAt && value.shiftEndAt && value.shiftEndAt <= value.shiftStartAt) {
    context.addIssue({ code: "custom", path: ["shiftEndAt"], message: "下班時間需晚於上班時間" });
  }
});

const cancelSchedule = z.object({
  operation: z.literal("CANCEL_SCHEDULE"),
  scheduleId: uuid,
}).strict();

const upsertHoliday = z.object({
  operation: z.literal("UPSERT_HOLIDAY"),
  holidayDate: calendarDate,
  name: z.string().trim().min(1).max(120),
  multiplierBps: z.number().int().min(10_000).max(50_000),
  note: z.string().trim().max(300).nullable().optional(),
}).strict();

const reviewLeave = z.object({
  operation: z.literal("REVIEW_LEAVE"),
  leaveRequestId: uuid,
  decision: z.enum(["APPROVED", "REJECTED"]),
  reviewNote: optionalNote,
}).strict();

const cancelLeave = z.object({
  operation: z.literal("CANCEL_LEAVE"),
  leaveRequestId: uuid,
  reviewNote: optionalNote,
}).strict();

const generatePayroll = z.object({
  operation: z.literal("GENERATE_PAYROLL"),
  periodStart: calendarDate,
  periodEnd: calendarDate,
}).strict().refine((value) => value.periodEnd >= value.periodStart, {
  path: ["periodEnd"], message: "薪資期間結束日不得早於開始日",
});

const finalizePayroll = z.object({
  operation: z.literal("FINALIZE_PAYROLL"),
  payrollPeriodId: uuid,
}).strict();

export const workforceManagerCommandSchema = z.discriminatedUnion("operation", [
  updatePolicy,
  setWageRate,
  createSchedule,
  cancelSchedule,
  upsertHoliday,
  reviewLeave,
  cancelLeave,
  generatePayroll,
  finalizePayroll,
]);

const createLeaveRequest = z.object({
  operation: z.literal("CREATE_LEAVE_REQUEST"),
  leaveType: z.enum(["DAY_OFF", "ANNUAL", "PERSONAL", "SICK", "FAMILY", "OTHER"]),
  startDate: calendarDate,
  endDate: calendarDate,
  reason: z.string().trim().max(500).nullable().optional(),
}).strict().refine((value) => value.endDate >= value.startDate, {
  path: ["endDate"], message: "結束日不得早於開始日",
});

const cancelLeaveRequest = z.object({
  operation: z.literal("CANCEL_LEAVE_REQUEST"),
  leaveRequestId: uuid,
}).strict();

export const leaveRequestCommandSchema = z.union([createLeaveRequest, cancelLeaveRequest]);

export type WorkforceManagerCommand = z.infer<typeof workforceManagerCommandSchema>;
export type LeaveRequestCommand = z.infer<typeof leaveRequestCommandSchema>;
