import type { AppLocale } from "@/lib/app-locale";

export function localizedCatalogName(
  entry: { name: string; translations?: readonly { locale: string; name: string }[] },
  locale: AppLocale,
) {
  return entry.translations?.find((translation) => (
    translation.locale === locale && translation.name.trim().length > 0
  ))?.name ?? entry.name;
}
