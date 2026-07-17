"use client";

import { Download, Lightbulb, LightbulbOff, Signal, SignalLow, WifiOff } from "lucide-react";
import { usePwaRuntime } from "@/components/pwa-runtime";

export function PwaControls({ showWakeLock = false }: { showWakeLock?: boolean }) {
  const runtime = usePwaRuntime();
  const qualityLabel = runtime.quality === "OFFLINE"
    ? "離線唯讀"
    : runtime.quality === "POOR"
      ? "網路較差"
      : "網路正常";
  const QualityIcon = runtime.quality === "OFFLINE" ? WifiOff : runtime.quality === "POOR" ? SignalLow : Signal;

  return (
    <div className="flex items-center gap-1" aria-label="應用程式狀態">
      <span title={`${qualityLabel}${runtime.effectiveType ? ` · ${runtime.effectiveType}` : ""}`} className={`inline-flex h-10 items-center gap-2 px-2 text-xs font-semibold ${runtime.quality === "GOOD" ? "text-emerald-700" : runtime.quality === "POOR" ? "text-amber-800" : "text-red-700"}`}>
        <QualityIcon className="h-4 w-4" aria-hidden="true" />
        <span className="hidden xl:inline">{qualityLabel}</span>
      </span>
      {runtime.installAvailable ? (
        <button type="button" title="安裝 StallOrder" onClick={() => void runtime.requestInstall()} className="grid h-10 w-10 place-items-center rounded-md hover:bg-stone-100">
          <Download className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">安裝 StallOrder</span>
        </button>
      ) : null}
      {showWakeLock && runtime.wakeLockSupported ? (
        <button type="button" aria-pressed={runtime.wakeLockActive} title={runtime.wakeLockActive ? "關閉螢幕保持喚醒" : "開啟螢幕保持喚醒"} onClick={() => void runtime.toggleWakeLock()} className={`grid h-10 w-10 place-items-center rounded-md border ${runtime.wakeLockActive ? "border-teal-600 bg-teal-50 text-teal-800" : "border-stone-300 bg-white text-stone-600"}`}>
          {runtime.wakeLockActive ? <Lightbulb className="h-4 w-4" /> : <LightbulbOff className="h-4 w-4" />}
          <span className="sr-only">{runtime.wakeLockActive ? "螢幕保持喚醒中" : "螢幕保持喚醒未啟用"}</span>
        </button>
      ) : null}
    </div>
  );
}
