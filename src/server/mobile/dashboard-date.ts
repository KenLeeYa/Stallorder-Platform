export function calendarDateInTimeZone(date: Date, timeZone: string) {
  try {
    const parts = new Map(new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date).map((part) => [part.type, part.value]));
    const year = parts.get("year");
    const month = parts.get("month");
    const day = parts.get("day");
    return year && month && day ? `${year}-${month}-${day}` : null;
  } catch {
    return null;
  }
}
