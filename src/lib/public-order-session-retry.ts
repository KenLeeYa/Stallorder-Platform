export function shouldRotateSessionRequestId(status: number, code: string) {
  return code.length > 0 && status >= 400 && status < 500;
}

export type PublicOrderingMode = "DEFAULT" | "DELIVERY" | "PREORDER";

export function shouldIncludeFullSessionMenu(
  hasInitialMenu: boolean,
  orderingMode: PublicOrderingMode,
) {
  return !hasInitialMenu || orderingMode === "PREORDER";
}

export function resolvePublicOrderingMode(
  candidate: unknown,
  fallback: PublicOrderingMode,
): PublicOrderingMode {
  return candidate === "DEFAULT" || candidate === "DELIVERY" || candidate === "PREORDER"
    ? candidate
    : fallback;
}

export function shouldReloadResolvedSessionMenu(
  initialMenuMode: PublicOrderingMode,
  resolvedSessionMode: unknown,
) {
  return (
    resolvedSessionMode === "DEFAULT"
    || resolvedSessionMode === "DELIVERY"
    || resolvedSessionMode === "PREORDER"
  ) && resolvedSessionMode !== initialMenuMode;
}
