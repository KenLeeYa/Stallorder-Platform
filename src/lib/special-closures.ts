import { z } from "zod";
import type { AppLocale } from "@/lib/app-locale";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CLOSURE_DAYS = 366;

const systemClosureTitles: Record<string, Record<AppLocale, string>> = {
  "公休日": { "zh-TW": "公休日", en: "Closed day", ja: "休業日", ko: "휴무일", vi: "Ngày nghỉ", th: "วันหยุด" },
  "臨時店休": { "zh-TW": "臨時店休", en: "Temporary closure", ja: "臨時休業", ko: "임시 휴무", vi: "Tạm nghỉ", th: "ปิดชั่วคราว" },
  "臨時停業": { "zh-TW": "臨時停業", en: "Temporary closure", ja: "臨時休業", ko: "임시 휴무", vi: "Tạm ngừng hoạt động", th: "ปิดชั่วคราว" },
  "店休": { "zh-TW": "店休", en: "Closed", ja: "休業", ko: "휴무", vi: "Nghỉ bán", th: "ร้านปิด" },
};

export function localizeSpecialClosureTitle(title: string, locale: AppLocale) {
  return systemClosureTitles[title.trim()]?.[locale] ?? title;
}

export type SpecialClosureView = {
  id: string;
  startsOn: string;
  endsOn: string;
  title: string;
  message: string;
};

const dateField = z.string().regex(DATE_PATTERN, "日期格式必須為 YYYY-MM-DD。").refine(
  (value) => new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value,
  "日期不存在。",
);

const closureFieldShape = {
  startsOn: dateField,
  endsOn: dateField,
  title: z.string().trim().min(1, "請輸入公告標題。").max(80, "公告標題最多 80 個字。"),
  message: z.string().trim().max(240, "公告內容最多 240 個字。"),
};

const createSpecialClosureSchema = z.object({
  operation: z.literal("CREATE"),
  ...closureFieldShape,
}).strict().superRefine((value, context) => {
  const startsAt = Date.parse(`${value.startsOn}T00:00:00.000Z`);
  const endsAt = Date.parse(`${value.endsOn}T00:00:00.000Z`);
  if (endsAt < startsAt) {
    context.addIssue({ code: "custom", path: ["endsOn"], message: "結束日期不得早於開始日期。" });
    return;
  }
  if ((endsAt - startsAt) / 86_400_000 + 1 > MAX_CLOSURE_DAYS) {
    context.addIssue({ code: "custom", path: ["endsOn"], message: "單次公休區間最多 366 天。" });
  }
});

export const specialClosureCommandSchema = z.discriminatedUnion("operation", [
  createSpecialClosureSchema,
  z.object({ operation: z.literal("DELETE"), closureId: z.string().uuid() }).strict(),
]);

export function serializeSpecialClosure(closure: {
  id: string;
  startsOn: Date;
  endsOn: Date;
  title: string;
  message: string;
}): SpecialClosureView {
  return {
    id: closure.id,
    startsOn: closure.startsOn.toISOString().slice(0, 10),
    endsOn: closure.endsOn.toISOString().slice(0, 10),
    title: closure.title,
    message: closure.message,
  };
}

export function dateInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
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

export function activeSpecialClosure(
  closures: readonly SpecialClosureView[],
  timeZone: string,
  now = new Date(),
) {
  const localDate = dateInTimeZone(now, timeZone);
  return closures.find((closure) => (
    closure.startsOn <= localDate && closure.endsOn >= localDate
  )) ?? null;
}

export function filterPreorderSlotsForSpecialClosures(
  slots: readonly string[],
  closures: readonly SpecialClosureView[],
  timeZone: string,
) {
  return slots.filter((slot) => {
    const instant = new Date(slot);
    if (Number.isNaN(instant.getTime())) return false;
    const localDate = dateInTimeZone(instant, timeZone);
    return !closures.some((closure) => (
      localDate >= closure.startsOn && localDate <= closure.endsOn
    ));
  });
}
