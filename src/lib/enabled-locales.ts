import { isQrLocale, QR_LOCALES, type QrLocale } from "@/lib/qr-order-i18n";

export const SOURCE_LOCALE = "zh-TW" as const;

export const TRANSLATION_LOCALE_OPTIONS = [
  { locale: "en", label: "英文" },
  { locale: "ja", label: "日文" },
  { locale: "ko", label: "韓文" },
  { locale: "vi", label: "越南文" },
  { locale: "th", label: "泰文" },
] as const;

export type TranslationLocale = (typeof TRANSLATION_LOCALE_OPTIONS)[number]["locale"];

export function normalizeEnabledLocales(locales: readonly string[] | null | undefined): QrLocale[] {
  const enabled = new Set((locales ?? []).filter(isQrLocale));
  enabled.add(SOURCE_LOCALE);
  return QR_LOCALES.filter((locale) => enabled.has(locale));
}

export function mergeEnabledLocales(stallLocales: ReadonlyArray<readonly string[]>): QrLocale[] {
  const enabled = new Set<QrLocale>([SOURCE_LOCALE]);
  for (const locales of stallLocales) {
    for (const locale of locales) {
      if (isQrLocale(locale)) enabled.add(locale);
    }
  }
  return QR_LOCALES.filter((locale) => enabled.has(locale));
}

export function getEnabledTranslationLocales(locales: readonly string[]): TranslationLocale[] {
  const enabled = new Set(normalizeEnabledLocales(locales));
  return TRANSLATION_LOCALE_OPTIONS
    .filter((option) => enabled.has(option.locale))
    .map((option) => option.locale);
}

export function getTranslationLocaleOptions(locales: readonly string[]) {
  const enabled = new Set(getEnabledTranslationLocales(locales));
  return TRANSLATION_LOCALE_OPTIONS.filter((option) => enabled.has(option.locale));
}
