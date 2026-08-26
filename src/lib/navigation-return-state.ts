export function normalizeInternalNavigationPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return null;
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
