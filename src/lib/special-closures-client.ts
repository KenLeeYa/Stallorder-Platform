import type { AppLocale } from "@/lib/app-locale";

const systemClosureTitles: Record<string, Record<AppLocale, string>> = {
  "公休日": { "zh-TW": "公休日", en: "Closed day", ja: "休業日", ko: "휴무일", vi: "Ngày nghỉ", th: "วันหยุด" },
  "臨時店休": { "zh-TW": "臨時店休", en: "Temporary closure", ja: "臨時休業", ko: "임시 휴무", vi: "Tạm nghỉ", th: "ปิดชั่วคราว" },
  "臨時停業": { "zh-TW": "臨時停業", en: "Temporary closure", ja: "臨時休業", ko: "임시 휴무", vi: "Tạm ngừng hoạt động", th: "ปิดชั่วคราว" },
  "店休": { "zh-TW": "店休", en: "Closed", ja: "休業", ko: "휴무", vi: "Nghỉ bán", th: "ร้านปิด" },
  "特殊營業時間": { "zh-TW": "特殊營業時間", en: "Special opening hours", ja: "特別営業時間", ko: "특별 영업시간", vi: "Giờ mở cửa đặc biệt", th: "เวลาทำการพิเศษ" },
};

export function localizeSpecialClosureTitle(title: string, locale: AppLocale) {
  return systemClosureTitles[title.trim()]?.[locale] ?? title;
}

export type SpecialClosureView = {
  id: string;
  startsOn: string;
  endsOn: string;
  opensAt?: string | null;
  closesAt?: string | null;
  title: string;
  message: string;
};

export function findOverlappingSpecialClosure(
  closures: readonly SpecialClosureView[],
  startsOn: string,
  endsOn: string,
  excludedClosureId?: string | null,
) {
  return closures.find((closure) => (
    closure.id !== excludedClosureId
    && closure.startsOn <= endsOn
    && closure.endsOn >= startsOn
  )) ?? null;
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

export function specialClosureAppliesOnDate(
  closure: Pick<SpecialClosureView, "startsOn" | "endsOn">,
  localDate: string,
) {
  return localDate >= closure.startsOn && localDate <= closure.endsOn;
}

function timeInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((part) => part.type === type)?.value ?? ""
  );
  return `${read("hour")}:${read("minute")}`;
}

export function specialClosureBlocksAt(
  closure: SpecialClosureView,
  timeZone: string,
  instant = new Date(),
) {
  const localDate = dateInTimeZone(instant, timeZone);
  if (!specialClosureAppliesOnDate(closure, localDate)) return false;
  if (!closure.opensAt || !closure.closesAt) return true;
  const localTime = timeInTimeZone(instant, timeZone);
  return localTime < closure.opensAt || localTime >= closure.closesAt;
}

export function activeSpecialClosure(
  closures: readonly SpecialClosureView[],
  timeZone: string,
  now = new Date(),
) {
  return closures.find((closure) => specialClosureBlocksAt(closure, timeZone, now)) ?? null;
}

export function filterPreorderSlotsForSpecialClosures(
  slots: readonly string[],
  closures: readonly SpecialClosureView[],
  timeZone: string,
) {
  return slots.filter((slot) => {
    const instant = new Date(slot);
    if (Number.isNaN(instant.getTime())) return false;
    return !closures.some((closure) => specialClosureBlocksAt(closure, timeZone, instant));
  });
}
