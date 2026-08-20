"use client";

import { Languages } from "lucide-react";
import { APP_LOCALES, type AppLocale } from "@/lib/app-locale";
import { useAppLocale } from "@/components/locale-provider";

const localeNames: Record<AppLocale, string> = {
  "zh-TW": "繁體中文",
  en: "English",
  ja: "日本語",
  ko: "한국어",
  vi: "Tiếng Việt",
  th: "ไทย",
};

export function LocaleSelector({
  className = "",
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const { locale, setLocale, t } = useAppLocale();
  const label = t("locale.label");

  return (
    <label
      title={label}
      className={`relative inline-flex min-h-10 items-center rounded-md border border-stone-300 bg-white text-sm text-stone-700 focus-within:ring-2 focus-within:ring-teal-600 focus-within:ring-offset-1 ${compact ? "h-10 w-10 justify-center" : "gap-2 px-2"} ${className}`}
    >
      <Languages className="h-4 w-4 text-teal-700" aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={locale}
        onChange={(event) => setLocale(event.target.value as AppLocale)}
        className={compact
          ? "absolute inset-0 h-full w-full cursor-pointer opacity-0"
          : "h-9 max-w-32 bg-transparent text-sm font-medium outline-none"}
      >
        {APP_LOCALES.map((candidate) => (
          <option key={candidate} value={candidate}>{localeNames[candidate]}</option>
        ))}
      </select>
    </label>
  );
}
