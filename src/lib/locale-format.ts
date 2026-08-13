import type { AppLocale } from "@/lib/app-locale";

export type AppDateInput = Date | number | string;

export function formatAppNumber(
  locale: AppLocale,
  value: number | bigint,
  options?: Intl.NumberFormatOptions,
) {
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatAppCurrency(
  locale: AppLocale,
  value: number | bigint,
  currency = "TWD",
  options: Omit<Intl.NumberFormatOptions, "currency" | "style"> = {},
) {
  return formatAppNumber(locale, value, {
    ...options,
    style: "currency",
    currency,
  });
}

export function formatAppDate(
  locale: AppLocale,
  value: AppDateInput,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
) {
  return new Intl.DateTimeFormat(locale, options).format(toDate(value));
}

export function formatAppDateTime(
  locale: AppLocale,
  value: AppDateInput,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
  },
) {
  return formatAppDate(locale, value, options);
}

function toDate(value: AppDateInput) {
  return value instanceof Date ? value : new Date(value);
}
