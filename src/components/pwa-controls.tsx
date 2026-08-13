"use client";

import { Download, Lightbulb, LightbulbOff, Signal, SignalLow, WifiOff } from "lucide-react";
import { LocaleSelector } from "@/components/locale-selector";
import { useAppLocale } from "@/components/locale-provider";
import { usePwaRuntime } from "@/components/pwa-runtime";
import { ThemeToggle } from "@/components/theme-toggle";

export function PwaControls({ showWakeLock = false }: { showWakeLock?: boolean }) {
  const { t } = useAppLocale();
  const runtime = usePwaRuntime();
  const qualityLabel = runtime.quality === "OFFLINE"
    ? t("pwa.network.offline")
    : runtime.quality === "POOR"
      ? t("pwa.network.poor")
      : t("pwa.network.good");
  const QualityIcon = runtime.quality === "OFFLINE" ? WifiOff : runtime.quality === "POOR" ? SignalLow : Signal;

  return (
    <div className="flex items-center gap-1" aria-label={t("pwa.status.label")}>
      <LocaleSelector compact />
      <ThemeToggle />
      <span title={`${qualityLabel}${runtime.effectiveType ? ` · ${runtime.effectiveType}` : ""}`} className={`inline-flex h-10 items-center gap-2 px-2 text-xs font-semibold ${runtime.quality === "GOOD" ? "text-emerald-700" : runtime.quality === "POOR" ? "text-amber-800" : "text-red-700"}`}>
        <QualityIcon className="h-4 w-4" aria-hidden="true" />
        <span className="hidden xl:inline">{qualityLabel}</span>
      </span>
      {runtime.installAvailable ? (
        <button type="button" title={t("pwa.install")} onClick={() => void runtime.requestInstall()} className="grid h-10 w-10 place-items-center rounded-md hover:bg-stone-100">
          <Download className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">{t("pwa.install")}</span>
        </button>
      ) : null}
      {showWakeLock && runtime.wakeLockSupported ? (
        <button type="button" aria-pressed={runtime.wakeLockActive} title={runtime.wakeLockActive ? t("pwa.wakeLock.disable") : t("pwa.wakeLock.enable")} onClick={() => void runtime.toggleWakeLock()} className={`grid h-10 w-10 place-items-center rounded-md border ${runtime.wakeLockActive ? "border-teal-600 bg-teal-50 text-teal-800" : "border-stone-300 bg-white text-stone-600"}`}>
          {runtime.wakeLockActive ? <Lightbulb className="h-4 w-4" /> : <LightbulbOff className="h-4 w-4" />}
          <span className="sr-only">{runtime.wakeLockActive ? t("pwa.wakeLock.active") : t("pwa.wakeLock.inactive")}</span>
        </button>
      ) : null}
    </div>
  );
}
