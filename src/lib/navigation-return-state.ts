export function normalizeInternalNavigationPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return null;
  // LIFF adds login material to its initialization URL; never persist that URL.
  if (/^\/mini(?:[/?#]|$)/.test(value)) return null;
  return value;
}

export function navigationReturnKey(path: string) {
  return `stallorder:navigation:return:${path}`;
}

export function navigationScrollKey(path: string) {
  return `stallorder:navigation:scroll:${path}`;
}

export function navigationRestoreKey(path: string) {
  return `stallorder:navigation:restore:${path}`;
}

export function navigationHorizontalScrollKey(toolbarId: string) {
  return `stallorder:navigation:horizontal:${encodeURIComponent(toolbarId)}`;
}

// Scroll/return memory is optional; blocked storage must never prevent navigation.
export function readNavigationState(key: string) {
  try { return window.sessionStorage.getItem(key); } catch { return null; }
}

export function writeNavigationState(key: string, value: string) {
  try { window.sessionStorage.setItem(key, value); } catch { /* Navigate without remembering position. */ }
}

export function removeNavigationState(key: string) {
  try { window.sessionStorage.removeItem(key); } catch { /* Storage may be unavailable in private mode. */ }
}
