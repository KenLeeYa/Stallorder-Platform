import type { PrintJobView } from "@/lib/print-center-types";
import {
  buildOperationsPageMeta,
  type OperationsPageSize,
} from "@/lib/operations-pagination";

export type PrintJobDatePreset = "DAY" | "WEEK" | "MONTH";

function calendarDateInTimeZone(value: Date | string, timeZone: string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((part) => part.type === type)?.value ?? ""
  );
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function moveCalendarDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function printJobDateRange(
  preset: PrintJobDatePreset,
  now = new Date(),
  timeZone = "Asia/Taipei",
) {
  const dateTo = calendarDateInTimeZone(now, timeZone);
  if (preset === "DAY") return { dateFrom: dateTo, dateTo };
  if (preset === "MONTH") return { dateFrom: `${dateTo.slice(0, 8)}01`, dateTo };
  const weekday = new Date(`${dateTo}T00:00:00.000Z`).getUTCDay();
  return {
    dateFrom: moveCalendarDate(dateTo, -(weekday === 0 ? 6 : weekday - 1)),
    dateTo,
  };
}

export function filterPrintJobsByDate(
  jobs: readonly PrintJobView[],
  dateFrom: string,
  dateTo: string,
  timeZone = "Asia/Taipei",
) {
  return jobs.filter((job) => {
    const date = calendarDateInTimeZone(job.order.createdAt, timeZone);
    return Boolean(
      date
      && (!dateFrom || date >= dateFrom)
      && (!dateTo || date <= dateTo),
    );
  });
}

export function slicePrintJobPage(
  jobs: readonly PrintJobView[],
  page: number,
  pageSize: OperationsPageSize,
) {
  const pagination = buildOperationsPageMeta(jobs.length, { page, pageSize });
  const start = (pagination.page - 1) * pagination.pageSize;
  return {
    items: jobs.slice(start, start + pagination.pageSize),
    pagination,
  };
}
