import { z } from "zod";

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export const businessDayLabels = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"] as const;

function isTime(value: unknown): value is string {
  return typeof value === "string" && TIME_PATTERN.test(value);
}

const businessHourSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  opensAt: z.unknown(),
  closesAt: z.unknown(),
  isClosed: z.boolean(),
}).strict().superRefine((hour, context) => {
  if (hour.isClosed) return;
  if (!isTime(hour.opensAt)) {
    context.addIssue({ code: "custom", path: ["opensAt"], message: "時間格式必須為 HH:mm。" });
  }
  if (!isTime(hour.closesAt)) {
    context.addIssue({ code: "custom", path: ["closesAt"], message: "時間格式必須為 HH:mm。" });
  }
}).transform((hour) => ({
  ...hour,
  // 公休日仍寫入符合資料庫 constraint 的合法值，避免停用控制項留下空字串。
  opensAt: isTime(hour.opensAt) ? hour.opensAt : "00:00",
  closesAt: isTime(hour.closesAt) ? hour.closesAt : "00:00",
}));

export const businessHoursSchema = z.object({
  hours: z.array(businessHourSchema).length(7).refine(
    (hours) => new Set(hours.map((hour) => hour.dayOfWeek)).size === 7,
    "每個星期日只能設定一次。",
  ),
}).strict();

export const defaultBusinessHours = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek,
  opensAt: "17:00",
  closesAt: "23:00",
  isClosed: dayOfWeek === 1,
}));

export function getBusinessHoursFieldErrors(error: z.ZodError) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const index = issue.path[0] === "hours" && typeof issue.path[1] === "number"
      ? issue.path[1]
      : null;
    const field = typeof issue.path[2] === "string" ? issue.path[2] : null;
    if (index !== null && (field === "opensAt" || field === "closesAt")) {
      const key = `hours.${index}.${field}`;
      const dayLabel = businessDayLabels[index] ?? `第 ${index + 1} 天`;
      const timeLabel = field === "opensAt" ? "開始時間" : "結束時間";
      fieldErrors[key] ??= `${dayLabel}${timeLabel}格式必須為 HH:mm。`;
      continue;
    }
    if (!fieldErrors.hours) {
      fieldErrors.hours = /[\u3400-\u9fff]/u.test(issue.message)
        ? issue.message
        : "營業時間的格式或內容不符合輸入要求。";
    }
  }
  return fieldErrors;
}
