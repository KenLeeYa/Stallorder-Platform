export const ACCESSIBILITY_MODE_STORAGE_KEY = "stallorder.accessibility.preference";
export const ACCESSIBILITY_MODE_CHANGE_EVENT = "stallorder:accessibility-mode-change";

export type AccessibilityMode = "standard" | "senior";

export function isAccessibilityMode(value: unknown): value is AccessibilityMode {
  return value === "standard" || value === "senior";
}

export function oppositeAccessibilityMode(mode: AccessibilityMode): AccessibilityMode {
  return mode === "senior" ? "standard" : "senior";
}

export function shouldUseMobileSeniorMenu(mode: AccessibilityMode, mobile: boolean): boolean {
  return mode === "senior" && mobile;
}

export function readAccessibilityMode(): AccessibilityMode {
  if (typeof document === "undefined") return "standard";
  const current = document.documentElement.dataset.interfaceMode;
  return isAccessibilityMode(current) ? current : "standard";
}

export function readServerAccessibilityMode(): AccessibilityMode {
  return "standard";
}

export function subscribeAccessibilityMode(onStoreChange: () => void) {
  window.addEventListener(ACCESSIBILITY_MODE_CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(ACCESSIBILITY_MODE_CHANGE_EVENT, onStoreChange);
}

export const initializeAccessibilityModeScript = `(() => {
  try {
    const stored = window.localStorage.getItem(${JSON.stringify(ACCESSIBILITY_MODE_STORAGE_KEY)});
    document.documentElement.dataset.interfaceMode = stored === "senior" ? "senior" : "standard";
  } catch {
    document.documentElement.dataset.interfaceMode = "standard";
  }
})();`;
