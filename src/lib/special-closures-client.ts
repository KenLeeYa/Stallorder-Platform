import type { AppLocale } from "@/lib/app-locale";

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
