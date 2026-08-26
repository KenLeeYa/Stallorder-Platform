"use client";

import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import {
  navigationRestoreKey,
  navigationReturnKey,
  normalizeInternalNavigationPath,
} from "@/lib/navigation-return-state";

export function ContextualBackButton({
  fallbackHref,
  children,
  className = "inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-teal-800",
}: {
  fallbackHref: string;
  children: ReactNode;
  className?: string;
}) {
  function returnToPreviousView() {
    const currentPath = normalizeInternalNavigationPath(
      `${window.location.pathname}${window.location.search}${window.location.hash}`,
    );
    const storedPath = currentPath
      ? normalizeInternalNavigationPath(window.sessionStorage.getItem(navigationReturnKey(currentPath)))
      : null;
    const targetPath = storedPath ?? normalizeInternalNavigationPath(fallbackHref);
    if (!targetPath) return;
    if (currentPath) window.sessionStorage.removeItem(navigationReturnKey(currentPath));
    window.sessionStorage.setItem(navigationRestoreKey(targetPath), "1");
    window.location.assign(targetPath);
  }

  return (
    <button type="button" onClick={returnToPreviousView} className={className}>
      <ArrowLeft className="h-4 w-4" />
      {children}
    </button>
  );
}
