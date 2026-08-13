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

export function LocaleSelector({ className = "" }: { className?: string }) {
  const { locale, setLocale, t } = useAppLocale();
  const label = t("locale.label");

  return (
    <label className={`inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 bg-white px-2 text-sm text-stone-700 ${className}`}>
      <Languages className="h-4 w-4 text-teal-700" aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={locale}
        onChange={(event) => setLocale(event.target.value as AppLocale)}
        className="h-9 max-w-32 bg-transparent text-sm font-medium outline-none"
      >
        {APP_LOCALES.map((candidate) => (
          <option key={candidate} value={candidate}>{localeNames[candidate]}</option>
        ))}
      </select>
    </label>
  );
}
