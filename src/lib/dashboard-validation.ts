import { z } from "zod";

export function isIsoCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

const isoDate = z.string().refine(isIsoCalendarDate, { message: "日期格式不正確。" });

export const dashboardQuerySchema = z.object({
  organizationId: z.string().uuid(),
  stallIds: z.array(z.string().uuid()).max(50).refine(
    (ids) => new Set(ids).size === ids.length,
    { message: "攤位清單不可重複。" },
  ),
  dateFrom: isoDate,
  dateTo: isoDate,
}).strict().superRefine((value, context) => {
  const range = dashboardDateRange(value.dateFrom, value.dateTo);
  if (!range.ok) context.addIssue({ code: "custom", message: range.error });
});

export function dashboardDateRange(dateFrom: string, dateTo: string, maxDays = 93) {
  if (!isIsoCalendarDate(dateFrom) || !isIsoCalendarDate(dateTo)) {
    return { ok: false as const, error: "日期格式不正確。" };
  }
  const from = new Date(`${dateFrom}T00:00:00.000Z`);
  const to = new Date(`${dateTo}T00:00:00.000Z`);
  const dayCount = Math.floor((to.valueOf() - from.valueOf()) / 86_400_000) + 1;
  if (dayCount < 1) return { ok: false as const, error: "結束日期不可早於開始日期。" };
  if (dayCount > maxDays) return { ok: false as const, error: `查詢區間不可超過 ${maxDays} 天。` };
  return { ok: true as const, dayCount, from, to };
}
