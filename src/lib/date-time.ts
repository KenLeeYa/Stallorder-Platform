const taipeiDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function formatTaipeiDateTime(value: string | Date) {
  const parts = new Map(
    taipeiDateTimeFormatter.formatToParts(new Date(value)).map((part) => [part.type, part.value]),
  );
  return `${parts.get("year")}/${parts.get("month")}/${parts.get("day")} ${parts.get("hour")}:${parts.get("minute")}:${parts.get("second")}`;
}

export function calendarDateInTimeZone(value: Date, timeZone: string) {
  const parts = zonedParts(value, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

type LocalDateParts = { year: number; month: number; day: number; hour: number; minute: number };

function zonedParts(date: Date, timeZone: string): LocalDateParts {
  const parts = new Map(new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.get("year")),
    month: Number(parts.get("month")),
    day: Number(parts.get("day")),
    hour: Number(parts.get("hour")),
    minute: Number(parts.get("minute")),
  };
}

function zonedDateTimeToUtc(parts: LocalDateParts, timeZone: string) {
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  let guess = target;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const current = zonedParts(new Date(guess), timeZone);
    const represented = Date.UTC(current.year, current.month - 1, current.day, current.hour, current.minute);
    const adjustment = represented - target;
    if (adjustment === 0) break;
    guess -= adjustment;
  }
  return new Date(guess);
}

export function zonedCalendarDayUtcRange(value: Date, timeZone: string) {
  const localDate = zonedParts(value, timeZone);
  const nextDate = new Date(Date.UTC(localDate.year, localDate.month - 1, localDate.day + 1));
  return {
    from: zonedDateTimeToUtc({ ...localDate, hour: 0, minute: 0 }, timeZone),
    to: zonedDateTimeToUtc({
      year: nextDate.getUTCFullYear(),
      month: nextDate.getUTCMonth() + 1,
      day: nextDate.getUTCDate(),
      hour: 0,
      minute: 0,
    }, timeZone),
  };
}

export function zonedCalendarDateRangeUtc(dateFrom: string, dateTo: string, timeZone: string) {
  const from = parseCalendarDate(dateFrom);
  const to = parseCalendarDate(dateTo);
  const dayAfterTo = new Date(Date.UTC(to.year, to.month - 1, to.day + 1));
  return {
    from: zonedDateTimeToUtc({ ...from, hour: 0, minute: 0 }, timeZone),
    to: zonedDateTimeToUtc({
      year: dayAfterTo.getUTCFullYear(),
      month: dayAfterTo.getUTCMonth() + 1,
      day: dayAfterTo.getUTCDate(),
      hour: 0,
      minute: 0,
    }, timeZone),
  };
}

function parseCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("INVALID_CALENDAR_DATE");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("INVALID_CALENDAR_DATE");
  }
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}
