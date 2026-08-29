"use client";

import { Accessibility, ScanFace } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useAppLocale } from "@/components/locale-provider";
import {
  ACCESSIBILITY_MODE_CHANGE_EVENT,
  ACCESSIBILITY_MODE_STORAGE_KEY,
  oppositeAccessibilityMode,
  readAccessibilityMode,
  readServerAccessibilityMode,
  subscribeAccessibilityMode,
} from "@/lib/accessibility-mode";

export function AccessibilityModeToggle() {
  const { t } = useAppLocale();
  const mode = useSyncExternalStore(
    subscribeAccessibilityMode,
    readAccessibilityMode,
    readServerAccessibilityMode,
  );
  const seniorMode = mode === "senior";
  const label = seniorMode ? t("accessibility.toStandard") : t("accessibility.toSenior");

  function toggleMode() {
    const next = oppositeAccessibilityMode(mode);
    document.documentElement.dataset.interfaceMode = next;
    try {
      window.localStorage.setItem(ACCESSIBILITY_MODE_STORAGE_KEY, next);
    } catch {
      // The current tab can still use the selected mode without persistent storage.
    }
    window.dispatchEvent(new Event(ACCESSIBILITY_MODE_CHANGE_EVENT));
  }

  return (
    <button
      type="button"
      data-testid="accessibility-mode-toggle"
      onClick={toggleMode}
      aria-label={label}
      aria-pressed={seniorMode}
      title={label}
      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border transition-colors ${seniorMode ? "border-teal-700 bg-teal-50 text-teal-800" : "border-stone-300 bg-white text-stone-700 hover:bg-stone-100"}`}
    >
      {seniorMode ? <ScanFace aria-hidden="true" className="h-5 w-5" /> : <Accessibility aria-hidden="true" className="h-5 w-5" />}
    </button>
  );
}
