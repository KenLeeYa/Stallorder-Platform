export function formatPreorderSlot(
  value: string,
  locale: string,
  timeZone: string,
) {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "short",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(value))
    .map((part) => part.value.replace(/\s/gu, " "))
    .join("");
}
