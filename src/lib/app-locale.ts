export const APP_LOCALES = ["zh-TW", "en", "ja", "ko", "vi", "th"] as const;
export const DEFAULT_APP_LOCALE = "zh-TW" as const;
export const APP_LOCALE_COOKIE = "stallorder_locale";
export const APP_LOCALE_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export type AppLocale = (typeof APP_LOCALES)[number];

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (APP_LOCALES as readonly string[]).includes(value);
}

export function matchAppLocale(languageTag: string): AppLocale | null {
  const normalized = languageTag.trim().replaceAll("_", "-").toLowerCase();
  if (!normalized || normalized === "*") return null;
  if (normalized === "zh" || normalized.startsWith("zh-")) return "zh-TW";

  const baseLanguage = normalized.split("-")[0];
  return APP_LOCALES.find((locale) => locale.toLowerCase() === baseLanguage) ?? null;
}

export function resolveAppLocale(
  cookieLocale: string | null | undefined,
  acceptLanguage: string | null | undefined,
): AppLocale {
  if (isAppLocale(cookieLocale)) return cookieLocale;

  const accepted = (acceptLanguage ?? "")
    .split(",")
    .map((entry, index) => {
      const [languageTag, ...parameters] = entry.trim().split(";");
      const qualityParameter = parameters.find((parameter) => parameter.trim().toLowerCase().startsWith("q="));
      const quality = qualityParameter ? Number(qualityParameter.trim().slice(2)) : 1;
      return {
        languageTag,
        quality: Number.isFinite(quality) && quality >= 0 && quality <= 1 ? quality : 0,
        index,
      };
    })
    .filter((entry) => entry.quality > 0)
    .sort((left, right) => right.quality - left.quality || left.index - right.index);

  for (const candidate of accepted) {
    const locale = matchAppLocale(candidate.languageTag);
    if (locale) return locale;
  }
  return DEFAULT_APP_LOCALE;
}

export function resolveNavigatorLocale(languages: readonly string[]): AppLocale {
  for (const language of languages) {
    const locale = matchAppLocale(language);
    if (locale) return locale;
  }
  return DEFAULT_APP_LOCALE;
}
